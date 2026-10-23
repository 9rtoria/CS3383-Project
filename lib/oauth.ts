import { createRemoteJWKSet, jwtVerify } from "jose";
import { appUrl } from "./env";

export type OAuthProvider = "github" | "google" | "apple";

type ProviderConfig = {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
};

export function oauthProvider(value: string): OAuthProvider | null {
  return value === "github" || value === "google" || value === "apple" ? value : null;
}

export function providerConfig(provider: OAuthProvider): ProviderConfig | null {
  if (provider === "github") {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scope: "read:user user:email",
    };
  }
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
    };
  }
  const clientId = process.env.APPLE_CLIENT_ID;
  const clientSecret = process.env.APPLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    authorizeUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    scope: "name email",
  };
}

export function oauthRedirectUri(provider: OAuthProvider): string {
  return `${appUrl().replace(/\/$/, "")}/api/auth/oauth/${provider}/callback`;
}

export function authorizeUrl(provider: OAuthProvider, state: string): string | null {
  const config = providerConfig(provider);
  if (!config) return null;
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", oauthRedirectUri(provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  if (provider === "google") {
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
  }
  if (provider === "apple") {
    url.searchParams.set("response_mode", "form_post");
  }
  return url.toString();
}

type OAuthProfile = {
  providerAccountId: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
};

async function postForm(url: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...headers },
    body: new URLSearchParams(fields),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof payload.error_description === "string" ? payload.error_description : typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(`OAuth token exchange failed: ${detail}`);
  }
  return payload;
}

export async function exchangeOAuthCode(provider: OAuthProvider, code: string): Promise<OAuthProfile> {
  const config = providerConfig(provider);
  if (!config) throw new Error("OAuth provider is not configured.");

  if (provider === "github") {
    const token = await postForm(config.tokenUrl, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: oauthRedirectUri(provider),
    });
    const accessToken = String(token.access_token ?? "");
    if (!accessToken) throw new Error("GitHub did not return an access token.");
    const headers = { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "user-agent": "Drift" };
    const userResponse = await fetch("https://api.github.com/user", { headers, cache: "no-store" });
    if (!userResponse.ok) throw new Error("Could not read the GitHub profile.");
    const user = (await userResponse.json()) as { id: number; login: string; name?: string | null; email?: string | null; avatar_url?: string | null };
    let email = user.email ?? null;
    if (!email) {
      const emailResponse = await fetch("https://api.github.com/user/emails", { headers, cache: "no-store" });
      if (emailResponse.ok) {
        const emails = (await emailResponse.json()) as { email: string; primary: boolean; verified: boolean }[];
        email = emails.find((item) => item.primary && item.verified)?.email ?? emails.find((item) => item.verified)?.email ?? null;
      }
    }
    return {
      providerAccountId: String(user.id),
      email: email?.toLowerCase() ?? null,
      name: user.name?.trim() || user.login,
      avatarUrl: user.avatar_url ?? null,
    };
  }

  if (provider === "google") {
    const token = await postForm(config.tokenUrl, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: oauthRedirectUri(provider),
    });
    const accessToken = String(token.access_token ?? "");
    if (!accessToken) throw new Error("Google did not return an access token.");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!profileResponse.ok) throw new Error("Could not read the Google profile.");
    const profile = (await profileResponse.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
    if (!profile.sub) throw new Error("Google returned an incomplete profile.");
    return {
      providerAccountId: profile.sub,
      email: profile.email && profile.email_verified !== false ? profile.email.toLowerCase() : null,
      name: profile.name?.trim() || profile.email?.split("@")[0] || "Google user",
      avatarUrl: profile.picture ?? null,
    };
  }

  const token = await postForm(config.tokenUrl, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: oauthRedirectUri(provider),
  });
  const idToken = String(token.id_token ?? "");
  if (!idToken) throw new Error("Apple did not return an identity token.");
  const jwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
  const verified = await jwtVerify(idToken, jwks, {
    issuer: "https://appleid.apple.com",
    audience: config.clientId,
  });
  const claims = verified.payload as { sub?: string; email?: string };
  if (!claims.sub) throw new Error("Apple returned an incomplete identity token.");
  return {
    providerAccountId: claims.sub,
    email: claims.email?.toLowerCase() ?? null,
    name: claims.email?.split("@")[0] ?? "Apple user",
    avatarUrl: null,
  };
}
