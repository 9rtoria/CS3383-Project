import {
  addDaysToDateString,
  addMonthsToDateString,
  dateStringInTimeZone,
  localDateTimeUtc,
  localNoonUtc,
  todayInTimeZone,
  weekdayOfDateString,
} from "./time";

export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";
export const PRIORITIES: TaskPriority[] = ["none", "low", "medium", "high", "urgent"];

export type ParsedQuickAdd = {
  title: string;
  priority: TaskPriority;
  labels: string[];
  estimateMinutes?: number;
  dueDate?: string;
  dueAllDay: boolean;
  recurrenceRule?: string;
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const DAY_CODE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function nextWeekday(today: string, target: number, forceNext = false): string {
  const current = weekdayOfDateString(today);
  let delta = (target - current + 7) % 7;
  if (forceNext && delta === 0) delta = 7;
  if (delta === 0 && !forceNext) delta = 0;
  return addDaysToDateString(today, delta);
}

function monthDate(now: string, month: number, day: number, year?: number): string {
  const currentYear = Number(now.slice(0, 4));
  let chosenYear = year ?? currentYear;
  if (!year) {
    const candidate = `${chosenYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (candidate < now) chosenYear += 1;
  }
  return `${chosenYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parses compact natural language without sending the title anywhere.
 * Supported: today/tomorrow/tonight, weekdays, next weekday, in N days/weeks,
 * ISO and month-name dates, 5pm/17:30 times, !priority, #label, ~30m estimates,
 * and simple recurrence ("every day", "every Monday", "every 2 weeks").
 */
export function parseQuickAdd(input: string, now = new Date(), timeZone = "UTC"): ParsedQuickAdd {
  let text = ` ${input.trim()} `;
  let priority: TaskPriority = "none";
  const labels: string[] = [];

  text = text.replace(/\s!(urgent|high|medium|low)\b/gi, (_, value: string) => {
    priority = value.toLowerCase() as TaskPriority;
    return " ";
  });

  text = text.replace(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu, (_, label: string) => {
    if (!labels.some((l) => l.toLowerCase() === label.toLowerCase())) labels.push(label);
    return " ";
  });

  let estimateMinutes: number | undefined;
  text = text.replace(/\s~(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/gi, (_, amount: string, unit: string) => {
    const value = Number(amount);
    estimateMinutes = Math.min(24 * 60, Math.round(unit.toLowerCase().startsWith("h") ? value * 60 : value));
    return " ";
  });

  let recurrenceRule: string | undefined;
  text = text.replace(/\s(?:every|each)\s+(\d+\s+)?(days?|weeks?|months?|weekdays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)\b/gi, (_, intervalRaw: string | undefined, unitRaw: string) => {
    const interval = Math.max(1, Number.parseInt(intervalRaw ?? "1", 10) || 1);
    const unit = unitRaw.toLowerCase().replace(/s$/, "");
    if (unit === "day") recurrenceRule = `FREQ=DAILY;INTERVAL=${interval}`;
    else if (unit === "week") recurrenceRule = `FREQ=WEEKLY;INTERVAL=${interval}`;
    else if (unit === "month") recurrenceRule = `FREQ=MONTHLY;INTERVAL=${interval}`;
    else if (unit === "weekday") recurrenceRule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    else recurrenceRule = `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${DAY_CODE[WEEKDAYS[unit]!]}`;
    return " ";
  });

  const today = todayInTimeZone(timeZone, now);
  let dateString: string | undefined;
  let explicitDate = false;
  let matchedTime: { hour: number; minute: number } | undefined;

  text = text.replace(/\s(?:on\s+|by\s+|due\s+)?(\d{4})-(\d{2})-(\d{2})(?!\d)/i, (_, y: string, m: string, d: string) => {
    dateString = `${y}-${m}-${d}`;
    explicitDate = true;
    return " ";
  });

  text = text.replace(/\s(?:on\s+|by\s+|due\s+)?(?:in\s+)?(\d+)\s+(day|days|week|weeks)\b/i, (_, amount: string, unit: string) => {
    const days = Number(amount) * (unit.toLowerCase().startsWith("week") ? 7 : 1);
    dateString = addDaysToDateString(today, days);
    explicitDate = true;
    return " ";
  });

  text = text.replace(/\s(?:on\s+|by\s+|due\s+)?(today|tonight|tomorrow)\b/i, (_, word: string) => {
    const value = word.toLowerCase();
    if (value === "tomorrow") dateString = addDaysToDateString(today, 1);
    else if (value === "tonight") {
      dateString = today;
      matchedTime = { hour: 20, minute: 0 };
    } else dateString = today;
    explicitDate = true;
    return " ";
  });

  text = text.replace(/\s(?:on\s+|by\s+|due\s+)?(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/i, (whole: string, day: string) => {
    if (dateString) return whole;
    dateString = nextWeekday(today, WEEKDAYS[day.toLowerCase()]!, /next\s+/i.test(whole));
    explicitDate = true;
    return " ";
  });

  text = text.replace(/\s(?:on\s+|by\s+|due\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i, (_, month: string, day: string, year?: string) => {
    dateString = monthDate(today, MONTHS[month.toLowerCase()]!, Number(day), year ? Number(year) : undefined);
    explicitDate = true;
    return " ";
  });

  text = text.replace(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (_, hourRaw: string, minuteRaw: string | undefined, meridiem: string) => {
    let hour = Number(hourRaw) % 12;
    if (meridiem.toLowerCase() === "pm") hour += 12;
    matchedTime = { hour, minute: Number(minuteRaw ?? 0) };
    if (!dateString) dateString = today;
    return " ";
  });

  if (!matchedTime && dateString) {
    const bareTime = text.match(/\s(?:at\s+)(\d{1,2}):(\d{2})\b/);
    if (bareTime) {
      matchedTime = { hour: Number(bareTime[1]), minute: Number(bareTime[2]) };
      text = text.replace(bareTime[0], " ");
    }
  }

  // A day word was consumed inside a recurrence phrase. Unless the user gave an
  // explicit date, schedule the first occurrence rather than defaulting to today.
  if (recurrenceRule && !explicitDate) {
    const byDay = /BYDAY=([A-Z,]+)/.exec(recurrenceRule)?.[1];
    if (byDay) {
      const target = byDay.split(",").map((code) => DAY_CODE.indexOf(code)).find((day) => day >= 0);
      dateString = target !== undefined ? nextWeekday(today, target, false) : today;
    } else if (recurrenceRule.startsWith("FREQ=DAILY")) dateString = today;
    else if (recurrenceRule.startsWith("FREQ=WEEKLY")) {
      const interval = Number(/INTERVAL=(\d+)/.exec(recurrenceRule)?.[1] ?? 1);
      dateString = addDaysToDateString(today, 7 * Math.max(1, interval));
    } else if (recurrenceRule.startsWith("FREQ=MONTHLY")) {
      const interval = Number(/INTERVAL=(\d+)/.exec(recurrenceRule)?.[1] ?? 1);
      dateString = addMonthsToDateString(today, Math.max(1, interval));
    }
  }

  const dueAllDay = !matchedTime;
  let dueDate: string | undefined;
  if (dateString) {
    const due = matchedTime
      ? localDateTimeUtc(dateString, matchedTime.hour, matchedTime.minute, timeZone)
      : localNoonUtc(dateString, timeZone);
    dueDate = due.toISOString();
  }

  const title = text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "")
    .replace(/\s+(?:at|on|by|due)\s*$/i, "")
    .trim();

  return {
    title,
    priority,
    labels,
    estimateMinutes,
    dueDate,
    dueAllDay,
    recurrenceRule,
  };
}

export function formatDueLabel(dueDate: string | null, allDay: boolean, timeZone: string, now = new Date()): string | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const today = todayInTimeZone(timeZone, now);
  const date = dateStringInTimeZone(due, timeZone);
  const day =
    date === today
      ? "Today"
      : date === addDaysToDateString(today, 1)
        ? "Tomorrow"
        : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone }).format(due);
  if (allDay) return day;
  return `${day}, ${new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone }).format(due)}`;
}
