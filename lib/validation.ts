import { z } from "zod";
import { PRIORITIES } from "./nlq";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "Password is too long")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a number");
export const nameSchema = z.string().trim().min(1, "Name is required").max(80);

export const prioritySchema = z.enum(PRIORITIES as [string, ...string[]]);

export const signupSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  timezone: z.string().max(80).optional(),
});

export const signinSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  totp: z.string().trim().max(20).optional(),
});

export const magicRequestSchema = z.object({
  email: emailSchema,
  next: z.string().startsWith("/").max(400).optional(),
});

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(["team", "org"]),
  seedTemplate: z.boolean().optional().default(false),
});

export const boardCreateSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().default(""),
  template: z.enum(["blank", "personal-week", "project-sprint", "content-calendar"]).optional().default("blank"),
  visibility: z.enum(["workspace", "private"]).optional().default("workspace"),
});

export const boardUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  visibility: z.enum(["workspace", "private"]).optional(),
  archived: z.boolean().optional(),
  version: z.number().int().positive(),
});

export const columnCreateSchema = z.object({
  boardId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  afterId: z.string().nullable().optional(),
});

export const columnUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  wipLimit: z.number().int().min(1).max(999).nullable().optional(),
  wipEnforced: z.boolean().optional(),
  isDone: z.boolean().optional(),
  position: z.string().max(100).optional(),
});

export const taskCreateSchema = z.object({
  workspaceId: z.string().min(1),
  boardId: z.string().min(1),
  columnId: z.string().min(1),
  title: z.string().trim().min(1, "A title is required").max(500),
  description: z.string().max(50_000).optional().default(""),
  priority: prioritySchema.optional().default("none"),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  dueAllDay: z.boolean().optional().default(true),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  estimateMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([]),
  recurrenceRule: z.string().max(200).nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  focusDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  afterId: z.string().nullable().optional(),
  clientId: z.string().max(100).optional(),
  reminderOffsetMinutes: z.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
});

export const taskUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(50_000).optional(),
    priority: prioritySchema.optional(),
    dueDate: z.string().datetime({ offset: true }).nullable().optional(),
    dueAllDay: z.boolean().optional(),
    startDate: z.string().datetime({ offset: true }).nullable().optional(),
    estimateMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
    completed: z.boolean().optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    recurrenceRule: z.string().max(200).nullable().optional(),
    assigneeId: z.string().nullable().optional(),
    focusDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    archived: z.boolean().optional(),
    reminderOffsetMinutes: z.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
    version: z.number().int().positive(),
    dependencyIds: z.array(z.string()).max(30).optional(),
  })
  .refine((value) => Object.keys(value).some((key) => !["version", "dependencyIds"].includes(key) || value.dependencyIds !== undefined), {
    message: "Provide at least one change",
  });

export const moveTaskSchema = z.object({
  columnId: z.string().min(1),
  beforeId: z.string().nullable().optional(),
  afterId: z.string().nullable().optional(),
  version: z.number().int().positive().optional(),
});

export const bulkTaskSchema = z.object({
  workspaceId: z.string().min(1),
  taskIds: z.array(z.string()).min(1).max(100),
  action: z.enum(["complete", "delete", "archive", "move"]),
  columnId: z.string().optional(),
});

export const labelSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(30).optional().default("slate"),
});

export const commentSchema = z.object({ body: z.string().trim().min(1).max(10_000) });
export const subtaskSchema = z.object({ title: z.string().trim().min(1).max(300) });
export const subtaskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  completed: z.boolean().optional(),
});

export const viewSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  type: z.enum(["board", "list", "calendar", "today"]),
  filtersJson: z.string().max(4000).optional().default("{}"),
});

export const automationSchema = z.object({
  workspaceId: z.string().min(1),
  boardId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(80),
  trigger: z.enum(["task.created", "task.moved", "task.completed"]),
  conditionsJson: z.string().max(2000).optional().default("{}"),
  actionType: z.enum(["set_priority", "add_label", "move_to_column", "notify"]),
  actionValue: z.string().trim().min(1).max(200),
  enabled: z.boolean().optional().default(true),
});

export const automationPreviewSchema = z.object({
  workspaceId: z.string().min(1),
  boardId: z.string().nullable().optional(),
  trigger: z.enum(["task.created", "task.moved", "task.completed"]),
  conditionsJson: z.string().max(2000).optional().default("{}"),
  actionType: z.enum(["set_priority", "add_label", "move_to_column", "notify"]),
  actionValue: z.string().trim().min(1).max(200),
});

export const inviteSchema = z.object({
  workspaceId: z.string().min(1),
  email: emailSchema,
  role: z.enum(["ADMIN", "MEMBER", "GUEST"]),
});

export const notificationUpdateSchema = z.object({
  read: z.boolean().optional(),
  all: z.boolean().optional(),
});

export const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  density: z.enum(["comfortable", "compact"]).optional(),
  capacityMinutes: z.number().int().min(15).max(1440).optional(),
  emailDigest: z.boolean().optional(),
  digestHour: z.number().int().min(0).max(23).optional(),
  quietStart: z.number().int().min(0).max(23).nullable().optional(),
  quietEnd: z.number().int().min(0).max(23).nullable().optional(),
  timezone: z.string().max(80).optional(),
  weekStartsOn: z.number().int().min(0).max(6).optional(),
  notificationsJson: z.string().max(2000).optional(),
});

export const workspacePolicySchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  auditRetentionDays: z.number().int().min(30).max(3650).optional(),
  requireMfa: z.boolean().optional(),
  aiEnabled: z.boolean().optional(),
  automationsEnabled: z.boolean().optional(),
  attachmentsEnabled: z.boolean().optional(),
  publicSharingEnabled: z.boolean().optional(),
  version: z.number().int().positive(),
});

export const mfaVerifySchema = z.object({ code: z.string().trim().min(6).max(20) });
export const mfaEnableSchema = z.object({ secret: z.string().min(16).max(100), code: z.string().trim().min(6).max(20) });

export const shareSchema = z.object({ enabled: z.boolean() });

export const importSchema = z.object({
  workspaceId: z.string().min(1),
  boardId: z.string().min(1),
  format: z.enum(["json", "csv"]),
  content: z.string().max(5_000_000),
});

export const ssoConfigSchema = z.object({
  workspaceId: z.string().min(1),
  issuer: z.string().url().max(500),
  clientId: z.string().trim().min(1).max(300),
  clientSecret: z.string().trim().max(500).optional().default(""),
  allowedDomains: z.string().trim().max(1000).optional().default(""),
  enabled: z.boolean().optional().default(true),
  enforceSso: z.boolean().optional().default(false),
});

export const apiTokenSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(365).optional().default(90),
});

export const webhookSchema = z.object({
  workspaceId: z.string().min(1),
  kind: z.enum(["slack", "teams", "generic"]),
  url: z.string().url().refine((value) => value.startsWith("https://"), "Use an HTTPS webhook URL"),
  events: z.array(z.enum(["task.created", "task.moved", "task.completed", "task.deleted"])).min(1),
});
