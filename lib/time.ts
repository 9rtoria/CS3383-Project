export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partFormatters.set(timeZone, fmt);
  }
  return fmt;
}

export function partsInTimeZone(date: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function zonedTimeToUtc(parts: Omit<ZonedParts, "second"> & { second?: number }, timeZone: string): Date {
  const desired: ZonedParts = { ...parts, second: parts.second ?? 0 };
  const utcGuess = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
  );
  let result = new Date(utcGuess);
  for (let i = 0; i < 3; i++) {
    const actual = partsInTimeZone(result, timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const diff = actualAsUtc - utcGuess;
    if (diff === 0) break;
    result = new Date(result.getTime() - diff);
  }
  return result;
}

export function dateStringInTimeZone(date: Date, timeZone: string): string {
  const p = partsInTimeZone(date, timeZone);
  return `${p.year.toString().padStart(4, "0")}-${p.month.toString().padStart(2, "0")}-${p.day
    .toString()
    .padStart(2, "0")}`;
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  return dateStringInTimeZone(now, timeZone);
}

export function addDaysToDateString(value: string, days: number): string {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonthsToDateString(value: string, months: number): string {
  const [y, m, d] = value.split("-").map(Number);
  const target = new Date(Date.UTC(y!, (m ?? 1) - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d ?? 1, lastDay));
  return target.toISOString().slice(0, 10);
}

export function weekdayOfDateString(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

export function startOfLocalDayUtc(dateString: string, timeZone: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return zonedTimeToUtc({ year: year!, month: month!, day: day!, hour: 0, minute: 0 }, timeZone);
}

export function endOfLocalDayUtc(dateString: string, timeZone: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return zonedTimeToUtc({ year: year!, month: month!, day: day!, hour: 23, minute: 59, second: 59 }, timeZone);
}

export function localNoonUtc(dateString: string, timeZone: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return zonedTimeToUtc({ year: year!, month: month!, day: day!, hour: 12, minute: 0 }, timeZone);
}

export function localDateTimeUtc(
  dateString: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return zonedTimeToUtc({ year: year!, month: month!, day: day!, hour, minute }, timeZone);
}

export function isOverdue(dueDate: Date | string | null, timeZone: string, now = new Date()): boolean {
  if (!dueDate) return false;
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  return dateStringInTimeZone(due, timeZone) < todayInTimeZone(timeZone, now);
}

export function formatTaskDate(
  value: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en", { ...options, timeZone }).format(date);
}

export function formatTime(value: Date | string, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone }).format(date);
}

export function formatDateTime(value: Date | string, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

export function relativeDayLabel(dateString: string, timeZone: string, now = new Date()): string {
  const today = todayInTimeZone(timeZone, now);
  if (dateString === today) return "Today";
  if (dateString === addDaysToDateString(today, 1)) return "Tomorrow";
  if (dateString === addDaysToDateString(today, -1)) return "Yesterday";
  const [y, m, d] = dateString.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)),
  );
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

export function dateFromMinutes(minutes: number): number {
  return Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes / 15) * 15));
}

export function monthGridStart(year: number, month: number, weekStartsOn = 1): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const day = first.getUTCDay();
  const diff = (day - weekStartsOn + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 - diff)).toISOString().slice(0, 10);
}

export function monthDays(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(input: string | null | undefined, fallback = "UTC"): string {
  return input && isValidTimeZone(input) ? input : fallback;
}
