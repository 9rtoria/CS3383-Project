import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signPayload } from "@/lib/crypto";
import { isProduction } from "@/lib/env";
import { discoverOidc, ssoAuthorizeUrl } from "@/lib/oidc";

type Params = { params: Promise<{ workspaceId: string }> };
const SSO_COOKIE = "drift_sso_state";

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params;
  const config = await prisma.oidcConfig.findUnique({ where: { workspaceId } });
  if (!config?.enabled) return NextResponse.redirect(new URL("/auth?error=sso_unavailable", req.url));
  try {
    const discovery = await discoverOidc(config.issuer);
    const nonce = crypto.randomUUID();
    const state = signPayload({ purpose: "sso", workspaceId, nonce }, 600);
    const target = ssoAuthorizeUrl(discovery, { clientId: config.clientId, workspaceId, state, nonce });
    const response = NextResponse.redirect(target);
    response.cookies.set({
      name: SSO_COOKIE,
      value: state,
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction(),
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "sso start failed", workspaceId, error: String(error) }));
    return NextResponse.redirect(new URL("/auth?error=sso_discovery_failed", req.url));
  }
}
