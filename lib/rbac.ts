export const ROLES = ["OWNER", "ADMIN", "MEMBER", "GUEST"] as const;
export type Role = (typeof ROLES)[number];

export type Action =
  | "workspace:read"
  | "workspace:update"
  | "workspace:delete"
  | "membership:read"
  | "membership:manage"
  | "board:create"
  | "board:update"
  | "board:delete"
  | "board:read"
  | "content:write"
  | "content:delete"
  | "comment:write"
  | "automation:manage"
  | "integration:manage"
  | "audit:read"
  | "policy:manage"
  | "sso:manage"
  | "data:export"
  | "user:invite";

const rank: Record<Role, number> = { GUEST: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function atLeast(role: Role, minimum: Role): boolean {
  return rank[role] >= rank[minimum];
}

const permissionMatrix: Record<Action, Role> = {
  "workspace:read": "GUEST",
  "workspace:update": "ADMIN",
  "workspace:delete": "OWNER",
  "membership:read": "GUEST",
  "membership:manage": "ADMIN",
  "board:create": "MEMBER",
  "board:update": "MEMBER",
  "board:delete": "ADMIN",
  "board:read": "GUEST",
  "content:write": "MEMBER",
  "content:delete": "MEMBER",
  "comment:write": "MEMBER",
  "automation:manage": "ADMIN",
  "integration:manage": "ADMIN",
  "audit:read": "ADMIN",
  "policy:manage": "ADMIN",
  "sso:manage": "ADMIN",
  "data:export": "GUEST",
  "user:invite": "ADMIN",
};

export function can(role: Role, action: Action): boolean {
  return atLeast(role, permissionMatrix[action]);
}

export function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) {
    const err = new Error("Your role does not allow this action.") as Error & { status?: number; code?: string };
    err.status = 403;
    err.code = "FORBIDDEN";
    throw err;
  }
}

export function publicRole(role: string): Exclude<Role, never> {
  return isRole(role) ? role : "GUEST";
}

/** Private boards are visible to their creator and workspace admins/owners. */
export function canReadBoard(
  role: Role,
  visibility: string,
  createdById: string | null,
  viewerId: string,
): boolean {
  if (visibility !== "private") return can(role, "board:read");
  return role === "OWNER" || role === "ADMIN" || createdById === viewerId;
}
