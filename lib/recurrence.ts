import { addDaysToDateString, addMonthsToDateString, localDateTimeUtc, partsInTimeZone, weekdayOfDateString } from "./time";

export type RecurrenceSpec = {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  byDay?: number[];
  count?: number;
};

const DAY_CODE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const CODE_DAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function parseRecurrence(rule: string | null | undefined): RecurrenceSpec | null {
  if (!rule) return null;
  const fields = Object.fromEntries(
    rule
      .split(";")
      .map((part) => part.split("="))
      .filter((entry) => entry.length === 2)
      .map(([k, v]) => [k!.toUpperCase(), v!.toUpperCase()]),
  );
  const frequency = fields.FREQ as RecurrenceSpec["frequency"] | undefined;
  if (!frequency || !["DAILY", "WEEKLY", "MONTHLY"].includes(frequency)) return null;
  const interval = Math.max(1, Math.min(52, Number.parseInt(fields.INTERVAL ?? "1", 10) || 1));
  const count = fields.COUNT ? Math.max(1, Number.parseInt(fields.COUNT, 10) || 1) : undefined;
  const byDay = fields.BYDAY
    ? fields.BYDAY.split(",")
        .map((code) => CODE_DAY[code])
        .filter((day): day is number => day !== undefined)
    : undefined;
  return { frequency, interval, ...(byDay?.length ? { byDay } : {}), ...(count ? { count } : {}) };
}

export function serializeRecurrence(spec: RecurrenceSpec): string {
  const parts = [`FREQ=${spec.frequency}`, `INTERVAL=${spec.interval}`];
  if (spec.byDay?.length) parts.push(`BYDAY=${spec.byDay.map((day) => DAY_CODE[day]).join(",")}`);
  if (spec.count) parts.push(`COUNT=${spec.count}`);
  return parts.join(";");
}

export function describeRecurrence(rule: string | null | undefined): string | null {
  const spec = parseRecurrence(rule);
  if (!spec) return null;
  const every = spec.interval === 1 ? "Every" : `Every ${spec.interval}`;
  if (spec.frequency === "DAILY") return spec.interval === 1 ? "Every day" : `Every ${spec.interval} days`;
  if (spec.frequency === "MONTHLY") return spec.interval === 1 ? "Every month" : `Every ${spec.interval} months`;
  if (spec.byDay?.length) {
    const names = spec.byDay.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ");
    return `${every} ${spec.interval === 1 ? "" : "weeks on "}${names}`.replace(/\s+/g, " ").trim();
  }
  return spec.interval === 1 ? "Every week" : `Every ${spec.interval} weeks`;
}

/**
 * Computes the next due instant in local wall-clock time, preserving the original
 * time-of-day across DST transitions. Returns null after an end boundary.
 */
export function nextOccurrence(
  rule: string | null | undefined,
  currentDue: Date,
  timeZone: string,
  allDay: boolean,
  endsAt?: Date | null,
): Date | null {
  const spec = parseRecurrence(rule);
  if (!spec) return null;
  const local = partsInTimeZone(currentDue, timeZone);
  const dateString = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
  let nextDate: string;

  if (spec.frequency === "DAILY") {
    nextDate = addDaysToDateString(dateString, spec.interval);
  } else if (spec.frequency === "MONTHLY") {
    nextDate = addMonthsToDateString(dateString, spec.interval);
  } else {
    if (spec.byDay?.length) {
      nextDate = "";
      for (let offset = 1; offset <= 14 * spec.interval; offset++) {
        const candidate = addDaysToDateString(dateString, offset);
        const weekday = weekdayOfDateString(candidate);
        const weekOffset = Math.floor(offset / 7);
        if (spec.byDay.includes(weekday) && weekOffset % spec.interval === 0) {
          nextDate = candidate;
          break;
        }
      }
      if (!nextDate) nextDate = addDaysToDateString(dateString, 7 * spec.interval);
    } else {
      nextDate = addDaysToDateString(dateString, 7 * spec.interval);
    }
  }

  const next = allDay
    ? localDateTimeUtc(nextDate, 12, 0, timeZone)
    : localDateTimeUtc(nextDate, local.hour, local.minute, timeZone);

  if (endsAt && next.getTime() > endsAt.getTime()) return null;
  return next;
}

export function recurrenceEndsAtFromRule(rule: string, start: Date, timeZone: string): Date | null {
  const spec = parseRecurrence(rule);
  if (!spec?.count) return null;
  let cursor = start;
  for (let i = 1; i < spec.count; i++) {
    const next = nextOccurrence(rule, cursor, timeZone, false);
    if (!next) break;
    cursor = next;
  }
  return cursor;
}
