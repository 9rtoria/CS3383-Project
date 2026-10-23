import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { requestMagicLink } from "@/lib/auth-service";
import { magicRequestSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  return handleApi(
    req,
    async ({ body, ip }) => {
      const input = magicRequestSchema.parse(body);
      const result = await requestMagicLink(input.email, ip, input.next ?? "/");
      return ok({
        sent: true,
        message: "If that email can receive mail, a one-time link is on its way.",
        ...(result.devUrl ? { devUrl: result.devUrl } : {}),
      });
    },
    { public: true, rateLimit: 6 },
  );
}
