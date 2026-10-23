import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(20_000).optional(),
  url: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, requestId, req: rawRequest }) => {
    const input = schema.parse(body);
    await prisma.clientError.create({
      data: {
        userId: viewer?.user.id ?? null,
        message: input.message.replace(/[\r\n]+/g, " ").slice(0, 2000),
        stack: input.stack?.slice(0, 20_000) ?? null,
        url: input.url?.slice(0, 1000) ?? null,
        userAgent: rawRequest.headers.get("user-agent")?.slice(0, 500) ?? null,
        requestId,
      },
    });
    return ok({ received: true }, 202);
  }, { public: true, rateLimit: 60 });
}
