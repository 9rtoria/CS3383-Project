export type ApiErrorPayload = {
  code?: string;
  message?: string;
  details?: unknown;
  requestId?: string;
};

export class ApiClientError extends Error {
  code: string;
  status: number;
  details?: unknown;
  requestId?: string;

  constructor(message: string, options: { code?: string; status?: number; details?: unknown; requestId?: string } = {}) {
    super(message);
    this.name = "ApiClientError";
    this.code = options.code ?? "UNKNOWN";
    this.status = options.status ?? 0;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  workspaceId?: string | null;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

/** Creates an idempotency key so retries and double-clicks never duplicate writes. */
export function newIdempotencyKey(prefix = "ui"): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.workspaceId) headers.set("x-workspace-id", options.workspaceId);
  if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);

  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    if (typeof window !== "undefined") window.dispatchEvent(new Event("drift-network-error"));
    throw new ApiClientError("You appear to be offline. Changes are kept on this device and will retry.", {
      code: "NETWORK_ERROR",
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json().catch(() => null)) as ApiErrorPayload | T | null)
    : null;

  if (!response.ok) {
    const errorPayload = (payload ?? {}) as ApiErrorPayload;
    if (response.status === 401) unauthorizedHandler?.();
    throw new ApiClientError(errorPayload.message ?? `Request failed (${response.status}).`, {
      code: errorPayload.code,
      status: response.status,
      details: errorPayload.details,
      requestId: errorPayload.requestId ?? response.headers.get("x-request-id") ?? undefined,
    });
  }
  return payload as T;
}

export function formatApiError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 409 && error.code === "VERSION_CONFLICT") {
      return "A newer version exists. Refresh to merge before saving.";
    }
    if (error.code === "WIP_LIMIT") return error.message;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
