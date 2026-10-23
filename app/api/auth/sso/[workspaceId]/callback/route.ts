import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { constantTimeEqual, decrypt, signPayload, verifySignedPayload } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { discoverOidc, exchangeSsoCode } from "@/lib/oidc";
import { recordAudit } from "@/lib/authz";
import {
  createSession,
  createStarterWorkspaceForUser,
  mergeGuestWorkspace,
  parseCookies,
  sessionCookie,
  viewerFromRequest,
} from "@/lib/session";

type Params = { params: Promise<{ workspaceId: string }> };
const SSO_COOKIE = "drift_sso_state";

function redirect(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, appUrl()));
}

async function complete(req: NextRequest, workspaceId: string, params: URLSearchParams): Promise<NextResponse> {
  const config = await prisma.oidcConfig.findUnique({ where: { workspaceId }, include: { workspace: true } });
  if (!config?.enabled || config.workspace.deletedAt) return redirect("/auth?error=sso_unavailable");
  const state = params.get("state") ?? "";
  const cookie = parseCookies(req.headers.get("cookie"))[SSO_COOKIE] ?? "";
  if (!state || !cookie || !constantTimeEqual(state, cookie)) return redirect("/auth?error=state_mismatch");
  const payload = verifySignedPayload<{ purpose: string; workspaceId: string }>(state);
  if (!payload || payload.purpose !== "sso" || payload.workspaceId !== workspaceId) return redirect("/auth?error=state_invalid");
  if (params.get("error")) return redirect("/auth?error=access_denied");
  const code = params.get("code");
  if (!code) return redirect("/auth?error=missing_code");

  try {
    const discovery = await discoverOidc(config.issuer);
    const profile = await exchangeSsoCode(discovery, {
      code,
      clientId: config.clientId,
      clientSecret: decrypt(config.clientSecretEnc),
      workspaceId,
    });
    if (!profile.email) return redirect("/auth?error=email_required");
    const domains = config.allowedDomains.split(",").map((domain) => domain.trim().toLowerCase()).filter(Boolean);
    if (domains.length && !domains.some((domain) => profile.email!.endsWith(`@${domain}`))) {
      return redirect("/auth?error=domain_not_allowed");
    }

    const current = await viewerFromRequest(req);
    const guestId = current?.user.isGuest ? current.user.id : null;
    let user = await prisma.user.findUnique({ where: { email: profile.email } });
    if (!user) {
      if (guestId) {
        user = await prisma.user.update({
          where: { id: guestId },
          data: { email: profile.email, emailVerified: new Date(), name: profile.name, avatarUrl: profile.avatarUrl, isGuest: false },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email: profile.email,
            emailVerified: new Date(),
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            isGuest: false,
          },
        });
        await createStarterWorkspaceForUser(user.id);
      }
    } else if (guestId && guestId !== user.id) {
      await mergeGuestWorkspace(guestId, user.id).catch(() => undefined);
    }
    if (!user || user.deletedAt) return redirect("/auth?error=account_unavailable");

    await prisma.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
      update: {},
      create: { userId: user.id, workspaceId, role: "MEMBER" },
    });
    await recordAudit({
      workspaceId,
      actorId: user.id,
      action: "sso.login",
      entityType: "user",
      entityId: user.id,
      requestId: crypto.randomUUID(),
      metadata: { issuer: config.issuer, email: profile.email },
    }).catch(() => undefined);

    if (user.mfaEnabled) {
      const challenge = signPayload({ sub: user.id, purpose: "mfa" }, 300);
      const target = new URL("/auth", appUrl());
      target.searchParams.set("mfa", "1");
      target.searchParams.set("challenge", challenge);
      const response = NextResponse.redirect(target);
      response.cookies.set({ name: SSO_COOKIE, value: "", path: "/", maxAge: 0 });
      return response;
    }

    const session = await createSession(user.id, {
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "sso",
      userAgent: req.headers.get("user-agent"),
      mfaVerified: true,
    });
    const response = redirect("/");
    response.cookies.set(sessionCookie(session.token));
    response.cookies.set({ name: SSO_COOKIE, value: "", path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "sso callback failed", workspaceId, error: String(error) }));
    return redirect("/auth?error=sso_failed");
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  return complete(req, (await params).workspaceId, new URL(req.url).searchParams);
}

export async function POST(req: NextRequest, { params }: Params) {
  const form = await req.formData();
  const query = new URLSearchParams();
  for (const [key, value] of form.entries()) if (typeof value === "string") query.set(key, value);
  return complete(req, (await params).workspaceId, query);
}
