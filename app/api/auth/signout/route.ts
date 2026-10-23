import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { revokeAllSessions, parseCookies, SESSION_COOKIE, sessionCookie } from "@/lib/session";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer }) => {
    await revokeAllSessions(viewer.user.id);
    const response = ok({ signedOutEverywhere: true });
    response.cookies.set({ ...sessionCookie(""), maxAge: 0 });
    return response;
  });
}

export async function DELETE(req: NextRequest) {
  return handleApi(req, async () => {
    const raw = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
    if (raw) await prisma.session.updateMany({ where: { tokenHash: sha256(raw) }, data: { revokedAt: new Date() } });
    const response = ok({ signedOut: true });
    response.cookies.set({ ...sessionCookie(""), maxAge: 0 });
    return response;
  });
}
