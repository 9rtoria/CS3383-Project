import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { constantTimeEqual, signPayload, verifySignedPayload } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { exchangeOAuthCode, oauthProvider, providerConfig } from "@/lib/oauth";
import {
  createSession,
  createStarterWorkspaceForUser,
  mergeGuestWorkspace,
  parseCookies,
  sessionCookie,
  viewerFromRequest,
} from "@/lib/session";

type Params = { params: Promise<{ provider: string }> };
const STATE_COOKIE = "drift_oauth_state";

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function redirect(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, appUrl()));
}

async function complete(req: NextRequest, providerValue: string, params: URLSearchParams): Promise<NextResponse> {
  const provider = oauthProvider(providerValue);
  if (!provider || !providerConfig(provider)) return redirect("/auth?error=provider_unavailable");
  const state = params.get("state") ?? "";
  const cookie = parseCookies(req.headers.get("cookie"))[STATE_COOKIE] ?? "";
  if (!state || !cookie || !constantTimeEqual(state, cookie)) return redirect("/auth?error=state_mismatch");
  const payload = verifySignedPayload<{ purpose: string; provider: string; next: string }>(state);
  if (!payload || payload.purpose !== "oauth" || payload.provider !== provider) return redirect("/auth?error=state_invalid");
  if (params.get("error")) return redirect("/auth?error=access_denied");

  const code = params.get("code");
  if (!code) return redirect("/auth?error=missing_code");

  try {
    const profile = await exchangeOAuthCode(provider, code);
    const current = await viewerFromRequest(req);
    const guestId = current?.user.isGuest ? current.user.id : null;

    let account = await prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId } },
      include: { user: true },
    });
    let user = account?.user ?? null;

    if (!user && profile.email) {
      user = await prisma.user.findUnique({ where: { email: profile.email } });
    }
    if (!user) {
      if (guestId) {
        user = await prisma.user.update({
          where: { id: guestId },
          data: {
            email: profile.email,
            emailVerified: profile.email ? new Date() : null,
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            isGuest: false,
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email: profile.email,
            emailVerified: profile.email ? new Date() : null,
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

    account = await prisma.oAuthAccount
      .create({ data: { userId: user.id, provider, providerAccountId: profile.providerAccountId }, include: { user: true } })
      .catch(async () => prisma.oAuthAccount.findUniqueOrThrow({
        where: { provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId } },
        include: { user: true },
      }));

    if (user.mfaEnabled) {
      const challenge = signPayload({ sub: user.id, purpose: "mfa" }, 300);
      const target = new URL("/auth", appUrl());
      target.searchParams.set("mfa", "1");
      target.searchParams.set("challenge", challenge);
      if (payload.next !== "/") target.searchParams.set("next", payload.next);
      const response = NextResponse.redirect(target);
      response.cookies.set({ name: STATE_COOKIE, value: "", path: "/", maxAge: 0 });
      return response;
    }

    const session = await createSession(account.user.id, {
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "oauth",
      userAgent: req.headers.get("user-agent"),
      mfaVerified: true,
    });
    const response = redirect(safeNext(payload.next));
    response.cookies.set(sessionCookie(session.token));
    response.cookies.set({ name: STATE_COOKIE, value: "", path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "oauth callback failed", provider, error: String(error) }));
    return redirect("/auth?error=oauth_failed");
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  return complete(req, (await params).provider, new URL(req.url).searchParams);
}

export async function POST(req: NextRequest, { params }: Params) {
  const form = await req.formData();
  const query = new URLSearchParams();
  for (const [key, value] of form.entries()) if (typeof value === "string") query.set(key, value);
  return complete(req, (await params).provider, query);
}
