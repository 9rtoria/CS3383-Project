import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handleApi } from "@/lib/api";
import { signPayload } from "@/lib/crypto";
import { isProduction } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { authorizeUrl, oauthProvider, providerConfig } from "@/lib/oauth";

type Params = { params: Promise<{ provider: string }> };

export const STATE_COOKIE = "drift_oauth_state";

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function GET(req: NextRequest, { params }: Params) {
  return handleApi(
    req,
    async () => {
      const provider = oauthProvider((await params).provider);
      if (!provider || !providerConfig(provider)) throw new ApiError("FEATURE_DISABLED", "That sign-in provider is not configured.");
      const next = safeNext(new URL(req.url).searchParams.get("next"));
      const state = signPayload({ purpose: "oauth", provider, next, nonce: crypto.randomUUID() }, 600);
      const target = authorizeUrl(provider, state);
      if (!target) throw new ApiError("FEATURE_DISABLED", "That sign-in provider is not configured.");
      const response = NextResponse.redirect(target);
      response.cookies.set({
        name: STATE_COOKIE,
        value: state,
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction(),
        path: "/",
        maxAge: 600,
      });
      return response;
    },
    { public: true, rateLimit: 40 },
  );
}
