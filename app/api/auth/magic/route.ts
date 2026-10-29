import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { requestMagicLink } from "@/lib/auth-service";
import { appUrl } from "@/lib/env";
import { randomToken } from "@/lib/crypto";
import { magicRequestSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  return handleApi(
    req,
    async ({ body, ip }) => {
      const input = magicRequestSchema.parse(body);
      // Bind the emailed token to this browser. A bearer link forwarded to a
      // different browser must not log that browser into the requester's account.
      const state = randomToken(24);
      const result = await requestMagicLink(input.email, ip, input.next ?? "/", state);
      const response = ok({
        sent: true,
        message: "If that email can receive mail, a one-time link is on its way.",
        ...(result.devUrl ? { devUrl: result.devUrl } : {}),
      });
      response.cookies.set({
        name: "drift_magic_state",
        value: state,
        httpOnly: true,
        sameSite: "lax",
        secure: appUrl().trim().startsWith("https://"),
        path: "/",
        maxAge: 15 * 60,
      });
      return response;
    },
    { public: true, rateLimit: 6 },
  );
}
