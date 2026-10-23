export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts.at(-1)![0] ?? ""}`.toUpperCase();
}

export function memberName(member: { name?: string | null; email?: string | null } | null | undefined): string {
  return member?.name || member?.email?.split("@")[0] || "Unassigned";
}

const DAY_MS = 86_400_000;

export function startOfDay(value: Date): Date {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function formatDate(value: string | Date | null | undefined, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatDue(value: string | Date | null | undefined, allDay = true): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diff = Math.round((target.getTime() - today.getTime()) / DAY_MS);
  if (diff === 0) return allDay ? "Today" : `Today ${formatTime(date)}`;
  if (diff === 1) return allDay ? "Tomorrow" : `Tomorrow ${formatTime(date)}`;
  if (diff === -1) return "Yesterday";
  if (diff < -1 && diff >= -7) return `${Math.abs(diff)} days ago`;
  if (diff > 1 && diff < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: "long", ...(allDay ? {} : { hour: "numeric", minute: "2-digit" }) }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}

export function isOverdue(value: string | Date | null | undefined, completedAt?: string | null): boolean {
  if (!value || completedAt) return false;
  const date = typeof value === "string" ? new Date(value) : value;
  return date.getTime() < startOfDay(new Date()).getTime();
}

export function isToday(value: string | Date | null | undefined): boolean {
  if (!value) return false;
  const date = typeof value === "string" ? new Date(value) : value;
  return startOfDay(date).getTime() === startOfDay(new Date()).getTime();
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 3_600_000;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)}d ago`;
  return formatDate(date, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function dateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

export function dueToIso(dateValue: string, timeValue?: string, allDay = true): string | null {
  if (!dateValue) return null;
  if (allDay || !timeValue) {
    const local = parseDateOnly(dateValue);
    local.setHours(17, 0, 0, 0);
    return local.toISOString();
  }
  const local = parseDateOnly(dateValue);
  const [hours, minutes] = timeValue.split(":").map(Number);
  local.setHours(hours ?? 9, minutes ?? 0, 0, 0);
  return local.toISOString();
}

export function isoToDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dateOnly(date);
}

export function isoToTimeInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function priorityLabel(priority: string): string {
  return priority === "none" ? "No priority" : priority.charAt(0).toUpperCase() + priority.slice(1);
}

export function roleLabel(role: string): string {
  return role === "OWNER" ? "Owner" : role === "ADMIN" ? "Admin" : role === "GUEST" ? "Guest" : "Member";
}

export function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function percent(value: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}
