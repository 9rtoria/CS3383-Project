import { NextResponse } from "next/server";
import { ZodError } from "zod";

export const ERROR_CODES = {
  UNAUTHORIZED: 401,
  MFA_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BOARD_NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  WORKSPACE_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  INVALID_CREDENTIALS: 401,
  EMAIL_TAKEN: 409,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  WIP_LIMIT: 409,
  DEPENDENCY_BLOCKED: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  FEATURE_DISABLED: 403,
  CSRF_FAILED: 403,
  INVALID_TOKEN: 401,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ApiError extends Error {
  status: number;
  code: ErrorCode;
  details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? defaultMessages[code]);
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }
}

const defaultMessages: Record<ErrorCode, string> = {
  UNAUTHORIZED: "Sign in to continue.",
  MFA_REQUIRED: "This workspace requires multi-factor authentication.",
  FORBIDDEN: "Your role does not allow this action.",
  NOT_FOUND: "That item could not be found.",
  BOARD_NOT_FOUND: "Board not found.",
  TASK_NOT_FOUND: "Task not found.",
  WORKSPACE_NOT_FOUND: "Workspace not found.",
  VALIDATION_ERROR: "Check the highlighted fields.",
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  EMAIL_TAKEN: "An account with this email already exists.",
  CONFLICT: "That change conflicts with newer data.",
  VERSION_CONFLICT: "This item changed elsewhere. Review the newer version.",
  WIP_LIMIT: "This column is at its work-in-progress limit.",
  DEPENDENCY_BLOCKED: "Finish dependent tasks before completing this one.",
  RATE_LIMITED: "Too many requests. Try again shortly.",
  PAYLOAD_TOO_LARGE: "That payload is too large.",
  UNSUPPORTED_MEDIA_TYPE: "This file type is not supported.",
  FEATURE_DISABLED: "This feature is disabled for this workspace.",
  CSRF_FAILED: "The request origin could not be verified.",
  INVALID_TOKEN: "This link is invalid or has expired.",
  INTERNAL_ERROR: "Something went wrong on our side.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable.",
};

export type ErrorEnvelope = {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
};

export function errorResponse(error: unknown, requestId: string): NextResponse<ErrorEnvelope> {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}), requestId },
      { status: error.status, headers: { "x-request-id": requestId } },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: "Check the highlighted fields.",
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        requestId,
      },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
  const err = error as { code?: string; status?: number; message?: string; meta?: unknown };
  if (err?.code === "P2025") {
    return NextResponse.json(
      { code: "NOT_FOUND", message: "That item no longer exists.", requestId },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }
  if (err?.code === "P2002") {
    return NextResponse.json(
      { code: "CONFLICT", message: "A unique value already exists.", requestId },
      { status: 409, headers: { "x-request-id": requestId } },
    );
  }
  console.error(JSON.stringify({ level: "error", requestId, message: err?.message ?? "unknown", stack: err instanceof Error ? err.stack : undefined }));
  return NextResponse.json(
    { code: "INTERNAL_ERROR", message: "Something went wrong on our side.", requestId },
    { status: 500, headers: { "x-request-id": requestId } },
  );
}

export function jsonError(code: ErrorCode, message: string, requestId: string): NextResponse<ErrorEnvelope> {
  return errorResponse(new ApiError(code, message), requestId);
}
