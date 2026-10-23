import type { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { hashIp, randomToken, sha256 } from "./crypto";
import { appUrl, isProduction } from "./env";
import { positionsBetween } from "./fractional";

export const SESSION_COOKIE = "drift_session";
export const SESSION_DAYS = 30;

export type Viewer = {
  user: {
    id: string;
    email: string | null;
    name: string;
    avatarUrl: string | null;
    isGuest: boolean;
    emailVerified: Date | null;
    timezone: string;
    mfaEnabled: boolean;
  };
  sessionId: string;
  mfaVerified: boolean;
  viaApiToken: boolean;
  apiWorkspaceId?: string;
};

export function sessionCookie(token: string, maxAge = SESSION_DAYS * 24 * 60 * 60) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction(),
    path: "/",
    maxAge,
  };
}

export function clearSessionCookie() {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction(),
    path: "/",
    maxAge: 0,
  };
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((pair) => {
      const index = pair.indexOf("=");
      return [pair.slice(0, index).trim(), decodeURIComponent(pair.slice(index + 1).trim())];
    }),
  );
}

async function hydrateSession(tokenHash: string): Promise<Viewer | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.deletedAt) return null;
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      avatarUrl: session.user.avatarUrl,
      isGuest: session.user.isGuest,
      emailVerified: session.user.emailVerified,
      timezone: session.user.timezone,
      mfaEnabled: session.user.mfaEnabled,
    },
    sessionId: session.id,
    mfaVerified: Boolean(session.mfaVerifiedAt) || !session.user.mfaEnabled,
    viaApiToken: false,
  };
}

export async function viewerFromRequest(req: Request): Promise<Viewer | null> {
  const authorization = req.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const raw = authorization.slice("Bearer ".length).trim();
    if (!raw.startsWith("drift_pat_")) return null;
    const token = await prisma.apiToken.findUnique({
      where: { tokenHash: sha256(raw) },
      include: { user: true },
    });
    if (!token || token.revokedAt || token.user.deletedAt || (token.expiresAt && token.expiresAt < new Date())) return null;
    await prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return {
      user: {
        id: token.user.id,
        email: token.user.email,
        name: token.user.name,
        avatarUrl: token.user.avatarUrl,
        isGuest: token.user.isGuest,
        emailVerified: token.user.emailVerified,
        timezone: token.user.timezone,
        mfaEnabled: token.user.mfaEnabled,
      },
      sessionId: `api_${token.id}`,
      mfaVerified: token.user.mfaEnabled,
      viaApiToken: true,
      apiWorkspaceId: token.workspaceId,
    };
  }
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  const viewer = await hydrateSession(sha256(token));
  if (!viewer) return null;
  // Best-effort activity timestamp; never block the request.
  void prisma.session
    .update({ where: { id: viewer.sessionId }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return viewer;
}

export async function viewerFromCookies(): Promise<Viewer | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return hydrateSession(sha256(token));
}

export async function getSessionRecordFromRequest(req: NextRequest | Request) {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  return prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
}

export async function createSession(
  userId: string,
  metadata: { ip?: string; userAgent?: string | null; mfaVerified: boolean },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      ipHash: metadata.ip ? hashIp(metadata.ip) : null,
      userAgent: metadata.userAgent?.slice(0, 300) ?? null,
      mfaVerifiedAt: metadata.mfaVerified ? new Date() : null,
    },
  });
  return { token, expiresAt };
}

export function setSession(response: NextResponse, token: string): NextResponse {
  response.cookies.set(sessionCookie(token));
  return response;
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

const STARTER_COLUMNS = [
  { name: "To do", isDone: false },
  { name: "In progress", isDone: false },
  { name: "Done", isDone: true },
];

export async function createGuest(): Promise<{ userId: string; token: string }> {
  const { user, workspace } = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        name: "You",
        isGuest: true,
        settings: { create: { capacityMinutes: 300 } },
      },
    });
    const createdWorkspace = await tx.workspace.create({
      data: {
        name: "Personal",
        type: "personal",
        memberships: { create: { userId: createdUser.id, role: "OWNER" } },
        labels: {
          create: [
            { name: "Personal", color: "moss" },
            { name: "Work", color: "blue" },
          ],
        },
      },
    });
    const board = await tx.board.create({
      data: {
        workspaceId: createdWorkspace.id,
        name: "My tasks",
        description: "A calm place for everything on your plate.",
        createdById: createdUser.id,
        visibility: "workspace",
      },
    });
    const positions = positionsBetween(null, null, STARTER_COLUMNS.length);
    await tx.column.createMany({
      data: STARTER_COLUMNS.map((column, index) => ({
        boardId: board.id,
        name: column.name,
        isDone: column.isDone,
        position: positions[index]!,
        createdById: createdUser.id,
      })),
    });
    return { user: createdUser, workspace: createdWorkspace };
  });
  void workspace;
  const session = await createSession(user.id, { mfaVerified: true, userAgent: "guest bootstrap" });
  return { userId: user.id, token: session.token };
}

/** Preserves first-task data when a guest signs into an existing account. */
export async function mergeGuestWorkspace(guestUserId: string, targetUserId: string): Promise<void> {
  if (guestUserId === targetUserId) return;
  const guest = await prisma.user.findUnique({
    where: { id: guestUserId },
    include: { memberships: { include: { workspace: true } } },
  });
  if (!guest?.isGuest) return;
  const personal = guest.memberships.find((m) => m.workspace.type === "personal" && !m.workspace.deletedAt);
  if (!personal) {
    await prisma.user.delete({ where: { id: guestUserId } }).catch(() => undefined);
    return;
  }
  const targetMembership = await prisma.membership.findFirst({
    where: { userId: targetUserId, workspace: { type: "personal", deletedAt: null } },
  });
  if (personal.workspaceId === targetMembership?.workspaceId) {
    await prisma.user.delete({ where: { id: guestUserId } }).catch(() => undefined);
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId: personal.workspaceId } },
      update: { role: "OWNER" },
      create: { userId: targetUserId, workspaceId: personal.workspaceId, role: "OWNER" },
    });
    if (!personal.workspace.name.toLowerCase().includes("imported")) {
      await tx.workspace.update({
        where: { id: personal.workspaceId },
        data: { name: "Imported personal" },
      });
    }
    await tx.user.delete({ where: { id: guestUserId } });
  });
}

export async function createStarterWorkspaceForUser(userId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        name: "Personal",
        type: "personal",
        memberships: { create: { userId, role: "OWNER" } },
      },
    });
    const board = await tx.board.create({
      data: {
        workspaceId: workspace.id,
        name: "My tasks",
        createdById: userId,
        visibility: "workspace",
      },
    });
    const positions = positionsBetween(null, null, STARTER_COLUMNS.length);
    for (let i = 0; i < STARTER_COLUMNS.length; i++) {
      await tx.column.create({
        data: {
          boardId: board.id,
          name: STARTER_COLUMNS[i]!.name,
          isDone: STARTER_COLUMNS[i]!.isDone,
          position: positions[i]!,
          createdById: userId,
        },
      });
    }
    return workspace.id;
  });
}

export function authUrl(path = "/"): string {
  return `${appUrl().replace(/\/$/, "")}${path}`;
}
