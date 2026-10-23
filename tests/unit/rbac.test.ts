import { describe, expect, it } from "vitest";
import { assertCan, atLeast, can, canReadBoard, isRole, publicRole } from "@/lib/rbac";

describe("RBAC matrix (FR-001b, FR-010)", () => {
  it("ranks roles and recognises only known roles", () => {
    expect(atLeast("OWNER", "ADMIN")).toBe(true);
    expect(atLeast("MEMBER", "ADMIN")).toBe(false);
    expect(isRole("GUEST")).toBe(true);
    expect(isRole("SUPERADMIN")).toBe(false);
    expect(publicRole("UNKNOWN")).toBe("GUEST");
  });

  it("prevents guests from writing content but allows read and export", () => {
    expect(can("GUEST", "board:read")).toBe(true);
    expect(can("GUEST", "data:export")).toBe(true);
    expect(can("GUEST", "content:write")).toBe(false);
    expect(can("GUEST", "membership:manage")).toBe(false);
  });

  it("reserves policy, SSO and workspace deletion for admins/owners", () => {
    expect(can("MEMBER", "policy:manage")).toBe(false);
    expect(can("ADMIN", "sso:manage")).toBe(true);
    expect(can("ADMIN", "workspace:delete")).toBe(false);
    expect(can("OWNER", "workspace:delete")).toBe(true);
  });

  it("throws a typed 403 for denied actions", () => {
    try {
      assertCan("GUEST", "board:create");
      throw new Error("expected assertCan to throw");
    } catch (error) {
      expect((error as { status?: number; code?: string }).status).toBe(403);
      expect((error as { code?: string }).code).toBe("FORBIDDEN");
    }
  });

  it("keeps private boards private unless the viewer is creator or admin", () => {
    expect(canReadBoard("MEMBER", "private", "creator", "other")).toBe(false);
    expect(canReadBoard("MEMBER", "private", "creator", "creator")).toBe(true);
    expect(canReadBoard("ADMIN", "private", "creator", "other")).toBe(true);
    expect(canReadBoard("GUEST", "workspace", null, "guest")).toBe(true);
  });
});
