import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { createGuest, sessionCookie, viewerFromRequest } from "@/lib/session";

export async function GET(req: NextRequest) {
  return handleApi(
    req,
    async ({ viewer, req: request }) => {
      if (viewer) return NextResponse.redirect(new URL("/", request.url));
      const guest = await createGuest();
      const response = NextResponse.redirect(new URL("/", request.url));
      response.cookies.set(sessionCookie(guest.token));
      return response;
    },
    { public: true },
  );
}

export async function POST(req: NextRequest) {
  return handleApi(
    req,
    async () => {
      const existing = await viewerFromRequest(req);
      if (existing) return ok({ created: false });
      const guest = await createGuest();
      const response = ok({ created: true });
      response.cookies.set(sessionCookie(guest.token));
      return response;
    },
    { public: true },
  );
}
