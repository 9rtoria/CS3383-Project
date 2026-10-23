import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handleApi } from "@/lib/api";
import { consumeMagicToken, userForMagicEmail } from "@/lib/auth-service";
import { createSession, sessionCookie, viewerFromRequest } from "@/lib/session";
import { ApiError } from "@/lib/errors";
import { signPayload } from "@/lib/crypto";

export async function GET(req: NextRequest) {
  return handleApi(
    req,
    async ({ req: request }) => {
      const url = new URL(request.url);
      const token = url.searchParams.get("token");
      const next = url.searchParams.get("next") ?? "/";
      if (!token) throw new ApiError("INVALID_TOKEN", "This sign-in link is incomplete.");
      const record = await consumeMagicToken(token);
      const current = await viewerFromRequest(request);
      const guestId = current?.user.isGuest ? current.user.id : null;
      const user = await userForMagicEmail(record.email, guestId);
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
      // A magic link proves email ownership, not possession of the second factor.
      // Send MFA-enabled accounts through the same challenge used by password sign-in.
      if (user.mfaEnabled) {
        const challenge = signPayload({ sub: user.id, purpose: "mfa" }, 300);
        const target = new URL("/auth", request.url);
        target.searchParams.set("mfa", "1");
        target.searchParams.set("challenge", challenge);
        if (safeNext !== "/") target.searchParams.set("next", safeNext);
        return NextResponse.redirect(target);
      }
      const session = await createSession(user.id, {
        ip: "magic-link",
        userAgent: request.headers.get("user-agent"),
        mfaVerified: true,
      });
      const response = NextResponse.redirect(new URL(safeNext, request.url));
      response.cookies.set(sessionCookie(session.token));
      return response;
    },
    { public: true, rateLimit: 20 },
  );
}
