import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "./db";
import { appUrl, clientIp } from "./env";
import { ApiError, errorResponse } from "./errors";
import { hashIp } from "./crypto";
import { viewerFromRequest, type Viewer } from "./session";

export type ApiContext<TBody = unknown> = {
  req: NextRequest;
  requestId: string;
  viewer: Viewer;
  body: TBody;
  ip: string;
  ipHash: string;
};

type ApiOptions = {
  public?: boolean;
  rateLimit?: number;
  raw?: boolean;
  skipCsrf?: boolean;
};

type RateEntry = { count: number; resetAt: number };
const globalRate = globalThis as unknown as { driftRate?: Map<string, RateEntry> };
const rateStore = globalRate.driftRate ?? new Map<string, RateEntry>();
globalRate.driftRate = rateStore;

function rateLimited(key: string, limit: number): { limited: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = rateStore.get(key);
  if (!entry || entry.resetAt <= now) {
    rateStore.set(key, { count: 1, resetAt: now + 60_000 });
    if (rateStore.size > 10_000) {
      for (const [storedKey, value] of rateStore) if (value.resetAt <= now) rateStore.delete(storedKey);
    }
    return { limited: false, retryAfter: 0 };
  }
  entry.count += 1;
  if (entry.count > limit) return { limited: true, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  return { limited: false, retryAfter: 0 };
}

function originAllowed(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(req.url).origin, new URL(appUrl()).origin]);
  return allowed.has(origin);
}

function attachRequestId(response: Response, requestId: string): Response {
  response.headers.set("x-request-id", requestId);
  return response;
}

const JSON_HEADERS = { "cache-control": "no-store" };

export function ok(data: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(data, { status, headers: { ...JSON_HEADERS, ...headers } });
}

/**
 * Shared route pipeline: request ID, auth, origin/CSRF check, rate limit,
 * idempotent replay, body parsing, error envelope, and structured logging.
 */
export async function handleApi(
  req: NextRequest,
  handler: (ctx: ApiContext) => Promise<Response>,
  options: ApiOptions = {},
): Promise<Response> {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  const url = new URL(req.url);
  const ip = clientIp(req);
  const method = req.method.toUpperCase();
  let viewer: Viewer | null = null;

  try {
    const limit = options.rateLimit ?? (url.pathname.startsWith("/api/auth") ? 20 : 180);
    const limited = rateLimited(`${options.public ? "anon" : "ip"}:${ip}:${url.pathname}`, limit);
    if (limited.limited) {
      const response = errorResponse(new ApiError("RATE_LIMITED"), requestId);
      response.headers.set("retry-after", String(limited.retryAfter));
      return response;
    }

    viewer = await viewerFromRequest(req);
    if (!viewer && !options.public) throw new ApiError("UNAUTHORIZED");

    if (method !== "GET" && method !== "HEAD" && !options.skipCsrf) {
      const hasBearer = Boolean(req.headers.get("authorization"));
      if (!hasBearer && !originAllowed(req)) throw new ApiError("CSRF_FAILED");
    }

    let body: unknown = null;
    if (method !== "GET" && method !== "HEAD" && !options.raw) {
      const raw = await req.text();
      if (raw.length > 2_000_000) throw new ApiError("PAYLOAD_TOO_LARGE");
      if (raw) {
        if (!req.headers.get("content-type")?.includes("application/json")) {
          throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Expected application/json.");
        }
        try {
          body = JSON.parse(raw);
        } catch {
          throw new ApiError("VALIDATION_ERROR", "Request body is not valid JSON.");
        }
      }
    }

    const idempotencyKey = req.headers.get("idempotency-key");
    if (viewer && idempotencyKey && method !== "GET" && method !== "HEAD") {
      const stored = await prisma.idempotencyKey.findUnique({
        where: { userId_key: { userId: viewer.user.id, key: idempotencyKey } },
      });
      if (stored) {
        if (stored.method !== method || stored.path !== url.pathname) {
          throw new ApiError("CONFLICT", "This idempotency key was already used for a different request.");
        }
        if (stored.expiresAt > new Date()) {
          return attachRequestId(
            new NextResponse(stored.responseJson, {
              status: stored.status,
              headers: { ...JSON_HEADERS, "idempotent-replayed": "true" },
            }),
            requestId,
          );
        }
      }
    }

    const response = await handler({
      req,
      requestId,
      viewer: viewer as Viewer,
      body,
      ip,
      ipHash: hashIp(ip),
    });

    if (viewer && idempotencyKey && method !== "GET" && method !== "HEAD" && response.status < 400) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const responseText = await response.clone().text();
        await prisma.idempotencyKey
          .create({
            data: {
              userId: viewer.user.id,
              workspaceId: viewer.apiWorkspaceId ?? req.headers.get("x-workspace-id"),
              key: idempotencyKey,
              method,
              path: url.pathname,
              status: response.status,
              responseJson: responseText,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          })
          .catch(() => undefined);
      }
    }

    console.info(
      JSON.stringify({
        level: "info",
        requestId,
        method,
        path: url.pathname,
        status: response.status,
        durationMs: Date.now() - started,
        userId: viewer?.user.id ?? null,
      }),
    );
    return attachRequestId(response, requestId);
  } catch (error) {
    const response = errorResponse(error, requestId);
    console.info(
      JSON.stringify({
        level: "warn",
        requestId,
        method,
        path: url.pathname,
        status: response.status,
        durationMs: Date.now() - started,
        userId: viewer?.user.id ?? null,
      }),
    );
    return attachRequestId(response, requestId);
  }
}

export function workspaceHeader(req: NextRequest): string | null {
  return req.headers.get("x-workspace-id") ?? new URL(req.url).searchParams.get("workspaceId");
}

export function rawJson(response: Response, status = 200): Response {
  response.headers.set("cache-control", "no-store");
  return new Response(response.body, { status, headers: response.headers });
}
