import { appUrl } from "./env";

export type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
};

function safeIssuer(issuer: string): URL {
  const url = new URL(issuer);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new Error("The OIDC issuer must use HTTPS.");
  return url;
}

export async function discoverOidc(issuer: string): Promise<Discovery> {
  const base = safeIssuer(issuer);
  const url = new URL(".well-known/openid-configuration", base.href.endsWith("/") ? base.href : `${base.href}/`);
  const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`OIDC discovery failed (${response.status}).`);
  const payload = (await response.json()) as Partial<Discovery>;
  if (!payload.authorization_endpoint || !payload.token_endpoint || !payload.userinfo_endpoint) {
    throw new Error("The OIDC discovery document is incomplete.");
  }
  const auth = new URL(payload.authorization_endpoint);
  const token = new URL(payload.token_endpoint);
  const userinfo = new URL(payload.userinfo_endpoint);
  for (const endpoint of [auth, token, userinfo]) {
    const local = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1";
    if (endpoint.protocol !== "https:" && !local) throw new Error("OIDC endpoints must use HTTPS.");
  }
  return {
    issuer: payload.issuer ?? issuer,
    authorization_endpoint: auth.toString(),
    token_endpoint: token.toString(),
    userinfo_endpoint: userinfo.toString(),
  };
}

export function ssoRedirectUri(workspaceId: string): string {
  return `${appUrl().replace(/\/$/, "")}/api/auth/sso/${encodeURIComponent(workspaceId)}/callback`;
}

export function ssoAuthorizeUrl(discovery: Discovery, input: { clientId: string; workspaceId: string; state: string; nonce: string }): string {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", ssoRedirectUri(input.workspaceId));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  return url.toString();
}

export async function exchangeSsoCode(discovery: Discovery, input: { code: string; clientId: string; clientSecret: string; workspaceId: string }) {
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: ssoRedirectUri(input.workspaceId),
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(`OIDC token exchange failed (${response.status}).`);
  const accessToken = String(payload.access_token ?? "");
  if (!accessToken) throw new Error("The OIDC provider did not return an access token.");
  const profileResponse = await fetch(discovery.userinfo_endpoint, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    cache: "no-store",
  });
  if (!profileResponse.ok) throw new Error(`OIDC userinfo failed (${profileResponse.status}).`);
  const profile = (await profileResponse.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
  if (!profile.sub) throw new Error("The OIDC provider returned an incomplete profile.");
  return {
    subject: profile.sub,
    email: profile.email?.toLowerCase() ?? null,
    emailVerified: profile.email_verified !== false,
    name: profile.name?.trim() || profile.email?.split("@")[0] || "Team member",
    avatarUrl: profile.picture ?? null,
  };
}
