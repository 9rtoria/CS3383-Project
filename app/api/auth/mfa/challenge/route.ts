import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { verifyMfaChallenge } from "@/lib/auth-service";
import { createSession, sessionCookie } from "@/lib/session";
import { z } from "zod";

const schema = z.object({ challenge: z.string().min(20).max(2000), code: z.string().trim().min(6).max(20) });

export async function POST(req: NextRequest) {
  return handleApi(
    req,
    async ({ body, ip }) => {
      const input = schema.parse(body);
      const result = await verifyMfaChallenge(input.challenge, input.code, {
        ip,
        userAgent: req.headers.get("user-agent"),
      });
      const session = await createSession(result.user.id, {
        ip,
        userAgent: req.headers.get("user-agent"),
        mfaVerified: true,
      });
      const response = ok({ mfaRequired: false, user: { id: result.user.id, name: result.user.name } });
      response.cookies.set(sessionCookie(session.token));
      return response;
    },
    { public: true, rateLimit: 10 },
  );
}
