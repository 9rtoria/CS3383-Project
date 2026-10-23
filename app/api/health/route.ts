import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  return handleApi(req, async () => {
    const started = Date.now();
    let database = "ok";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "error";
    }
    return ok({
      status: database === "ok" ? "ok" : "degraded",
      version: process.env.APP_VERSION ?? "1.0.0",
      database,
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    }, database === "ok" ? 200 : 503);
  }, { public: true, rateLimit: 300 });
}
