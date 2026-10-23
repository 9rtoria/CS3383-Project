export type SessionUser = {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  isGuest: boolean;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  timezone: string;
};

export type BoardColumn = {
  id: string;
  name: string;
  position?: string;
  isDone: boolean;
  wipLimit?: number | null;
  wipEnforced?: boolean;
};

export type BoardSummary = {
  id: string;
  name: string;
  description: string;
  visibility: string;
  firstColumnId: string | null;
  defaultDoneColumnId: string | null;
  taskCount: number;
  columns: BoardColumn[];
  shareEnabled: boolean;
  createdById: string | null;
};

export type Member = {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  role?: string;
  membershipId?: string;
};

export type WorkspacePolicies = {
  retentionDays: number;
  auditRetentionDays: number;
  requireMfa: boolean;
  aiEnabled: boolean;
  automationsEnabled: boolean;
  attachmentsEnabled: boolean;
  publicSharingEnabled: boolean;
  version: number;
};

export type Workspace = {
  id: string;
  name: string;
  type: "personal" | "team" | "org" | string;
  icon: string;
  role: string;
  mfaLocked: boolean;
  mfaRequired: boolean;
  memberCount: number;
  boards: BoardSummary[];
  members: Member[];
  policies: WorkspacePolicies;
};

export type UserSettings = {
  userId: string;
  theme: string;
  density: string;
  capacityMinutes: number;
  emailDigest: boolean;
  digestHour: number;
  quietStart: number | null;
  quietEnd: number | null;
  weekStartsOn: number;
  notificationsJson: string;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  workspaceId: string | null;
};

export type Label = {
  id: string;
  name: string;
  color: string;
  workspaceId?: string;
};

export type Subtask = {
  id: string;
  title: string;
  completed: boolean;
  position?: string;
};

export type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
};

export type Comment = {
  id: string;
  body: string;
  authorId: string | null;
  author?: { id: string; name: string; avatarUrl?: string | null } | null;
  createdAt: string;
};

export type Task = {
  id: string;
  workspaceId: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string;
  priority: "none" | "low" | "medium" | "high" | "urgent" | string;
  startDate: string | null;
  dueDate: string | null;
  dueAllDay: boolean;
  estimateMinutes: number | null;
  position: string;
  completedAt: string | null;
  recurrenceRule: string | null;
  recurrenceEndsAt?: string | null;
  focusDate: string | null;
  version: number;
  archivedAt: string | null;
  assignee: Member | null;
  labels: Label[];
  subtasks: Subtask[];
  attachments?: Attachment[];
  comments?: Comment[];
  reminders?: { id: string; remindAt: string }[];
  dependencies?: { id: string; title: string; completed: boolean }[];
  dependencyIds?: string[];
  openDependencies?: number;
  commentCount?: number;
  attachmentCount?: number;
  board?: { id: string; name: string; visibility?: string };
  column?: { id: string; name: string; isDone: boolean };
  createdAt?: string;
  updatedAt?: string;
};

export type Bootstrap = {
  user: SessionUser;
  workspaces: Workspace[];
  settings: UserSettings;
  notifications: Notification[];
  unreadCount: number;
  views: { id: string; name: string; type: string; filtersJson: string; isFavorite: boolean }[];
  templates: { id: string; name: string; description: string; columns: { name: string; isDone?: boolean; wipLimit?: number }[] }[];
  features: {
    emailConfigured: boolean;
    githubOAuth: boolean;
    googleOAuth: boolean;
    appleOAuth: boolean;
    aiKillSwitch: boolean;
    attachmentsDisabled: boolean;
    devEmailPreview: boolean;
    demoEnabled: boolean;
    apiDocs?: string;
    emailDelivery?: string;
  };
  oauthProviders: { id: string; label: string; enabled: boolean }[];
  serverNow: string;
  appUrl: string;
};

export type BoardPayload = {
  board: {
    id: string;
    workspaceId: string;
    name: string;
    description: string;
    color: string;
    visibility: string;
    version: number;
    shareEnabled: boolean;
    archivedAt: string | null;
    createdById: string | null;
    columns: BoardColumn[];
  };
  tasks: Task[];
  taskCount: number;
  truncated: boolean;
  members: Member[];
  labels: Label[];
  views: { id: string; name: string; type: string; filtersJson: string }[];
  automationCount: number;
  role: string;
  permissions: { canEdit: boolean; canManage: boolean; canShare: boolean };
};

export type TaskDetail = {
  task: Task;
  activity: { id: string; action: string; actor: { id: string; name: string } | null; createdAt: string; metadata: Record<string, unknown> | null; undoId?: string | null }[];
  permissions: { canEdit: boolean };
  labels: Label[];
  members: Member[];
};

export type TodayPayload = {
  date: string;
  capacity: { totalMinutes: number; selectedMinutes: number; remainingMinutes: number; percent: number; overbooked: boolean };
  suggestions: (Task & { reason: string; score: number; suggestedMinutes: number; selected: boolean; blocked: boolean; accepted: boolean })[];
  counts: { open: number; selected: number; overdue: number };
  aiEnabled: boolean;
  workspace: { id: string; name: string; type: string };
};

export type UpcomingPayload = {
  today: string;
  end: string;
  grouped: Record<string, Task[]>;
  count: number;
  days: number;
};

export type CalendarPayload = {
  month: string;
  byDate: Record<string, Task[]>;
  total: number;
};

export type SearchPayload = {
  results: (Task & { description: string; checklist: { total: number; done: number } })[];
  total: number;
  nextCursor: string | null;
  query: string;
};

export type ArchivePayload = {
  archivedBoards: { id: string; name: string; archivedAt: string | null; taskCount: number; version: number }[];
  archivedTasks: Task[];
};

export type InsightTask = {
  id: string;
  title: string;
  boardId: string;
  boardName: string;
  columnId: string;
  columnName: string;
  isDone: boolean;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  dueAllDay: boolean;
  estimateMinutes: number | null;
  completedAt: string | null;
  assignee: { id: string; name: string; email: string | null; avatarUrl: string | null } | null;
};

export type InsightsPayload = {
  today: string;
  end: string;
  days: number;
  boards: { id: string; name: string; visibility: string; open: number; done: number; overdue: number; estimateMinutes: number }[];
  members: {
    id: string | null;
    name: string;
    email: string | null;
    avatarUrl: string | null;
    role: string | null;
    open: number;
    dueThisWeek: number;
    overdue: number;
    estimateMinutes: number;
  }[];
  tasks: InsightTask[];
  totals: {
    open: number;
    overdue: number;
    dueThisWeek: number;
    completedLast7: number;
    estimateMinutes: number;
    unestimated: number;
    taskCount: number;
    truncated: boolean;
  };
};
