import { describe, expect, it } from "vitest";
import {
  boardCreateSchema,
  passwordSchema,
  settingsSchema,
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

  it("validates tracked focus minutes independently of estimates", () => {
    const base = { workspaceId: "w1", boardId: "b1", columnId: "c1", title: "Plan" };
    expect(taskCreateSchema.safeParse({ ...base, actualMinutes: 90 }).success).toBe(true);
    expect(taskUpdateSchema.safeParse({ version: 1, actualMinutes: 25 }).success).toBe(true);
    expect(taskUpdateSchema.safeParse({ version: 1, actualMinutes: null }).success).toBe(true);
    expect(taskUpdateSchema.safeParse({ version: 1, actualMinutes: -1 }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ version: 1, actualMinutes: 60 * 24 * 365 + 1 }).success).toBe(false);
  });

  it("only accepts HTTPS webhook URLs", () => {
    expect(webhookSchema.safeParse({ workspaceId: "w1", kind: "slack", url: "http://example.com/hook", events: ["task.created"] }).success).toBe(false);
    expect(webhookSchema.safeParse({ workspaceId: "w1", kind: "slack", url: "https://example.com/hook", events: ["task.created"] }).success).toBe(true);
  });

  it("guards every personalization field at the API boundary", () => {
    expect(settingsSchema.safeParse({
      theme: "system",
      density: "compact",
      locale: "zh-TW",
      timeFormat: "24",
      readingSize: "large",
      displayFont: "modern",
      accent: "ink",
      motion: "reduced",
      startView: "board",
      capacityMinutes: 480,
      planBufferPercent: 20,
      workdayStart: 8,
      workdayEnd: 18,
      blockBufferMinutes: 10,
      focusMinutes: 45,
      focusAutoStart: true,
      captureCloseAfterAdd: false,
      featuresJson: JSON.stringify({ dayFlow: true, smartPlan: false, voice: true }),
    }).success).toBe(true);
    expect(settingsSchema.safeParse({ theme: "neon" }).success).toBe(false);
    expect(settingsSchema.safeParse({ locale: "fr" }).success).toBe(false);
    expect(settingsSchema.safeParse({ planBufferPercent: 51 }).success).toBe(false);
    expect(settingsSchema.safeParse({ focusMinutes: 4 }).success).toBe(false);
    expect(settingsSchema.safeParse({ workdayEnd: 25 }).success).toBe(false);
    expect(settingsSchema.safeParse({ capacityMinutes: 14 }).success).toBe(false);
  });

  it("validates Auto-plan settings and boundaries", () => {
    expect(settingsSchema.safeParse({
      autoPlanEnabled: true,
      autoPlanMode: "delegated",
      autoPlanRestMinutes: 15,
      autoPlanWeeklyMinutes: 1800,
      autoPlanRefreshMinutes: 30,
      autoPlanDeepWorkMinutes: 90,
      autoPlanSplitLongTasks: true,
      autoPlanIncludeWeekends: false,
      autoPlanDefaultEstimateMinutes: 45,
      autoPlanCapBehavior: "stop",
      autoPlanLunchEnabled: true,
      autoPlanLunchStart: 12,
      autoPlanLunchEnd: 13,
      autoPlanAllowStaleArchive: false,
      autoPlanStaleDays: 30,
    }).success).toBe(true);
    expect(settingsSchema.safeParse({ autoPlanMode: "automatic" }).success).toBe(false);
    expect(settingsSchema.safeParse({ autoPlanRefreshMinutes: 10 }).success).toBe(false);
    expect(settingsSchema.safeParse({ autoPlanWeeklyMinutes: 30 }).success).toBe(false);
    expect(settingsSchema.safeParse({ autoPlanDeepWorkMinutes: 5 }).success).toBe(false);
    expect(settingsSchema.safeParse({ autoPlanLunchEnd: 25 }).success).toBe(false);
  });
});
