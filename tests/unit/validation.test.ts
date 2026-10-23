import { describe, expect, it } from "vitest";
import {
  boardCreateSchema,
  passwordSchema,
  signupSchema,
  taskCreateSchema,
  taskUpdateSchema,
  webhookSchema,
} from "@/lib/validation";

describe("Zod input validation (NFR-001, error contract)", () => {
  it("enforces password policy", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("alllowercase1").success).toBe(false);
    expect(passwordSchema.safeParse("GoodPassword1").success).toBe(true);
  });

  it("normalizes email addresses", () => {
    const result = signupSchema.parse({ name: " Sam ", email: " SAM@Example.COM ", password: "GoodPassword1" });
    expect(result.email).toBe("sam@example.com");
    expect(result.name).toBe("Sam");
  });

  it("applies safe defaults to board creation", () => {
    const result = boardCreateSchema.parse({ workspaceId: "w1", name: "Home" });
    expect(result).toMatchObject({ template: "blank", visibility: "workspace", description: "" });
  });

  it("requires a title and valid offset timestamps for tasks", () => {
    const base = { workspaceId: "w1", boardId: "b1", columnId: "c1" };
    expect(taskCreateSchema.safeParse({ ...base, title: "" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...base, title: "Plan", dueDate: "2026-10-24" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...base, title: "Plan", dueDate: "2026-10-24T12:00:00+02:00" }).success).toBe(true);
  });

  it("requires at least one real change for a task update", () => {
    expect(taskUpdateSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ version: 1, dependencyIds: [] }).success).toBe(true);
    expect(taskUpdateSchema.safeParse({ version: 1, title: "New" }).success).toBe(true);
  });

  it("only accepts HTTPS webhook URLs", () => {
    expect(webhookSchema.safeParse({ workspaceId: "w1", kind: "slack", url: "http://example.com/hook", events: ["task.created"] }).success).toBe(false);
    expect(webhookSchema.safeParse({ workspaceId: "w1", kind: "slack", url: "https://example.com/hook", events: ["task.created"] }).success).toBe(true);
  });
});
