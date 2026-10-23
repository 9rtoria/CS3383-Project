import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { signupGuest } from "@/lib/auth-service";
import { signupSchema } from "@/lib/validation";
import { createSession, revokeAllSessions, sessionCookie } from "@/lib/session";

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, ip }) => {
    const input = signupSchema.parse(body);
    const user = await signupGuest(viewer, input);
    // Rotate the guest session to reduce session-fixation risk. Only the new
    // opaque token survives, and it keeps the same user + workspace data.
    await revokeAllSessions(user.id);
    const session = await createSession(user.id, {
      ip,
      userAgent: req.headers.get("user-agent"),
      mfaVerified: true,
    });
    const response = ok({
      user: { id: user.id, name: user.name, email: user.email, isGuest: false },
      preserved: true,
    });
    response.cookies.set(sessionCookie(session.token));
    return response;
  });
}
