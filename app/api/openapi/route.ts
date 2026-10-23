import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { handleApi, ok } from "@/lib/api";

export async function GET(req: NextRequest) {
  return handleApi(req, async () => {
    try {
      const file = await fs.readFile(path.join(process.cwd(), "docs", "openapi.yaml"), "utf8");
      return new Response(file, {
        headers: { "content-type": "application/yaml; charset=utf-8", "cache-control": "public, max-age=300" },
      });
    } catch {
      return ok({ error: "OpenAPI description is not installed in this build." }, 404);
    }
  }, { public: true });
}
