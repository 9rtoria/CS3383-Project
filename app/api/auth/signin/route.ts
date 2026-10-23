import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { authenticateWithPassword } from "@/lib/auth-service";
import { signinSchema } from "@/lib/validation";
import { createSession, parseCookies, sessionCookie, SESSION_COOKIE, viewerFromRequest } from "@/lib/session";
import { ApiError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  return handleApi(
    req,
    async ({ body, ip }) => {
      const input = signinSchema.parse(body);
      const current = await viewerFromRequest(req);
      const guestId = current?.user.isGuest ? current.user.id : null;
      const result = await authenticateWithPassword(input, {
        ip,
        userAgent: req.headers.get("user-agent"),
        guestId,
      });
      if (result.mfaRequired) return ok({ mfaRequired: true, challenge: result.challenge });
      const session = await createSession(result.user.id, {
        ip,
        userAgent: req.headers.get("user-agent"),
        mfaVerified: true,
      });
      const response = ok({ mfaRequired: false, user: { id: result.user.id, name: result.user.name } });
      response.cookies.set(sessionCookie(session.token));
      return response;
    },
    { public: true },
  );
}

export async function DELETE(req: NextRequest) {
  return handleApi(req, async () => {
    const raw = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
    if (!raw) throw new ApiError("UNAUTHORIZED");
    const { sha256 } = await import("@/lib/crypto");
    const { prisma } = await import("@/lib/db");
    await prisma.session.updateMany({ where: { tokenHash: sha256(raw) }, data: { revokedAt: new Date() } });
    const response = ok({ signedOut: true });
    response.cookies.set({ ...sessionCookie(""), maxAge: 0 });
    return response;
  });
}
