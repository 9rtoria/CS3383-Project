import { addDaysToDateString, weekdayOfDateString } from "./time";

/**
 * Deterministic Auto-plan scheduler. It owns the plan layer only: task due
 * dates, completion, and user-authored fields are never returned as changes.
 */

export type AutoPlanMode = "suggest" | "safe" | "full" | "delegated";
export type AutoPlanCapBehavior = "stop" | "warn";
export type AutoPlanOptionId = "balanced" | "focus" | "light";

export type AutoPlanTask = {
  id: string;
  title: string;
  priority: string;
  dueDate: string | null;
  estimateMinutes: number | null;
  actualMinutes: number | null;
  focusDate: string | null;
  completedAt: string | null;
  openDependencies: number;
  updatedAt?: string;
};

export type AutoPlanBlock = {
  id?: string;
  taskId: string;
  title?: string;
  priority?: string;
  date: string;
  startMinute: number;
  minutes: number;
  source: "auto" | "manual";
  locked: boolean;
};

export type AutoPlanConstraints = {
  startDate: string;
  horizonDays: number;
  timeZone: string;
  now: Date;
  workdayStart: number;
  workdayEnd: number;
  dailyCapacityMinutes: number;
  weeklyCapacityMinutes: number;
  restMinutes: number;
  deepWorkMinutes: number;
  splitLongTasks: boolean;
  includeWeekends: boolean;
  defaultEstimateMinutes: number;
  capBehavior: AutoPlanCapBehavior;
  lunchEnabled: boolean;
  lunchStart: number;
  lunchEnd: number;
  existingBlocks: AutoPlanBlock[];
  actualMinutesByWeek: Record<string, number>;
};

export type AutoPlanUnscheduled = {
  taskId: string;
  title: string;
  reason: string;
};

export type AutoPlanWeek = {
  weekStart: string;
  actualMinutes: number;
  plannedMinutes: number;
  capMinutes: number;
  over: boolean;
};

export type AutoPlanOption = {
  id: AutoPlanOptionId;
  blocks: AutoPlanBlock[];
  unscheduled: AutoPlanUnscheduled[];
  scheduledMinutes: number;
  weeks: AutoPlanWeek[];
  warnings: string[];
  overCap: boolean;
  needsEstimate: number;
};

export type AutoPlanPreview = {
  startDate: string;
  horizonDays: number;
  weeklyCapacityMinutes: number;
  options: AutoPlanOption[];
  generatedAt: string;
};

type Interval = { start: number; end: number };
type MutableWeek = { actualMinutes: number; plannedMinutes: number; capMinutes: number };

const PRIORITY: Record<string, number> = { urgent: 300, high: 220, medium: 110, low: 40, none: 0 };
const MAX_HORIZON = 31;

function dateToMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function weekStartOf(date: string): string {
  const weekday = weekdayOfDateString(date);
  const distance = (weekday + 6) % 7;
  return addDaysToDateString(date, -distance);
}

export function weekDates(startDate: string, horizonDays: number): string[] {
  const days = Math.max(1, Math.min(MAX_HORIZON, Math.round(horizonDays)));
  return Array.from({ length: days }, (_, index) => addDaysToDateString(startDate, index));
}

function isWeekend(date: string): boolean {
  const day = weekdayOfDateString(date);
  return day === 0 || day === 6;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].filter((item) => item.end > item.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (!last || interval.start > last.end) merged.push({ ...interval });
    else last.end = Math.max(last.end, interval.end);
  }
  return merged;
}

function freeIntervals(start: number, end: number, busy: Interval[]): Interval[] {
  const merged = mergeIntervals(busy);
  const output: Interval[] = [];
  let cursor = start;
  for (const interval of merged) {
    if (interval.end <= cursor) continue;
    if (interval.start >= end) break;
    if (interval.start > cursor) output.push({ start: cursor, end: Math.min(end, interval.start) });
    cursor = Math.max(cursor, interval.end);
    if (cursor >= end) break;
  }
  if (cursor < end) output.push({ start: cursor, end });
  return output.filter((interval) => interval.end > interval.start);
}

function dueScore(task: AutoPlanTask, today: string): number {
  if (!task.dueDate) return 0;
  if (task.dueDate < today) return 900;
  if (task.dueDate === today) return 700;
  const days = Math.round((Date.parse(`${task.dueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (days <= 2) return 520;
  if (days <= 7) return 260;
  return 80;
}

function scoreTask(task: AutoPlanTask, today: string, variant: AutoPlanOptionId): number {
  let score = (PRIORITY[task.priority] ?? 0) + dueScore(task, today);
  if (task.focusDate === today) score += 240;
  if (task.estimateMinutes && task.estimateMinutes >= 60) score += 30;
  if (variant === "focus") {
    if (task.priority === "urgent" || task.priority === "high") score += 180;
    if ((task.estimateMinutes ?? 0) >= 60) score += 100;
    if (task.focusDate === today) score += 100;
  }
  if (variant === "light") {
    const urgent = task.priority === "urgent" || task.priority === "high";
    const soon = Boolean(task.dueDate && task.dueDate <= addDaysToDateString(today, 1));
    if (task.focusDate !== today && !urgent && !soon && !(task.dueDate && task.dueDate < today)) score -= 1000;
  }
  return score;
}

function taskChunks(task: AutoPlanTask, constraints: AutoPlanConstraints): number[] {
  const duration = Math.max(5, task.estimateMinutes ?? constraints.defaultEstimateMinutes);
  if (!constraints.splitLongTasks || duration <= constraints.deepWorkMinutes) return [duration];
  const chunks: number[] = [];
  let remaining = duration;
  while (remaining > 0) {
    chunks.push(Math.min(constraints.deepWorkMinutes, remaining));
    remaining -= constraints.deepWorkMinutes;
  }
  return chunks;
}

function isFixedBlock(block: AutoPlanBlock, constraints: AutoPlanConstraints): boolean {
  return (
    block.locked ||
    block.source === "manual" ||
    block.date < constraints.startDate ||
    (block.date === constraints.startDate && block.startMinute < dateToMinutes(constraints.now, constraints.timeZone))
  );
}

function buildWeekMap(dates: string[], constraints: AutoPlanConstraints): Map<string, MutableWeek> {
  const map = new Map<string, MutableWeek>();
  for (const date of dates) {
    const key = weekStartOf(date);
    if (!map.has(key)) {
      map.set(key, {
        actualMinutes: constraints.actualMinutesByWeek[key] ?? 0,
        plannedMinutes: 0,
        capMinutes: constraints.weeklyCapacityMinutes,
      });
    }
  }
  for (const block of constraints.existingBlocks) {
    if (!dates.includes(block.date) || !isFixedBlock(block, constraints)) continue;
    const key = weekStartOf(block.date);
    if (!map.has(key)) {
      map.set(key, {
        actualMinutes: constraints.actualMinutesByWeek[key] ?? 0,
        plannedMinutes: 0,
        capMinutes: constraints.weeklyCapacityMinutes,
      });
    }
    map.get(key)!.plannedMinutes += block.minutes;
  }
  return map;
}

function busyForDate(date: string, constraints: AutoPlanConstraints): Interval[] {
  const busy: Interval[] = [];
  const start = Math.max(0, constraints.workdayStart * 60);
  const end = Math.min(24 * 60, constraints.workdayEnd * 60);
  if (constraints.lunchEnabled && constraints.lunchEnd > constraints.lunchStart) {
    const lunchStart = Math.max(start, constraints.lunchStart * 60);
    const lunchEnd = Math.min(end, constraints.lunchEnd * 60);
    if (lunchEnd > lunchStart) busy.push({ start: lunchStart, end: lunchEnd });
  }
  for (const block of constraints.existingBlocks) {
    if (block.date !== date || !isFixedBlock(block, constraints)) continue;
    busy.push({ start: block.startMinute, end: block.startMinute + block.minutes });
  }
  return busy;
}

function buildOption(
  id: AutoPlanOptionId,
  tasks: AutoPlanTask[],
  constraints: AutoPlanConstraints,
  dates: string[],
): AutoPlanOption {
  const today = constraints.startDate;
  const weeks = buildWeekMap(dates, constraints);
  const blocks: AutoPlanBlock[] = [];
  const unscheduled: AutoPlanUnscheduled[] = [];
  const warnings: string[] = [];
  const plannedByDate = new Map<string, number>();
  const afterMinuteByDate = new Map<string, number>();
  let needsEstimate = 0;

  for (const block of constraints.existingBlocks) {
    if (!dates.includes(block.date) || !isFixedBlock(block, constraints)) continue;
    plannedByDate.set(block.date, (plannedByDate.get(block.date) ?? 0) + block.minutes);
  }

  const candidates = tasks
    .filter((task) => !task.completedAt)
    .filter((task) => {
      if (id !== "light") return true;
      if (task.openDependencies > 0) return false;
      const urgent = task.priority === "urgent" || task.priority === "high";
      const soon = Boolean(task.dueDate && task.dueDate <= addDaysToDateString(today, 1));
      return task.focusDate === today || urgent || soon || Boolean(task.dueDate && task.dueDate < today);
    })
    .sort((a, b) => scoreTask(b, today, id) - scoreTask(a, today, id) || (a.estimateMinutes ?? constraints.defaultEstimateMinutes) - (b.estimateMinutes ?? constraints.defaultEstimateMinutes));

  for (const task of candidates) {
    if (task.openDependencies > 0) {
      unscheduled.push({ taskId: task.id, title: task.title, reason: "Waiting on a dependency" });
      continue;
    }
    const chunks = taskChunks(task, constraints);
    if (!task.estimateMinutes) needsEstimate += 1;
    let placedAny = false;
    let placedCount = 0;
    let failedReason = "No room before the horizon";
    for (const chunk of chunks) {
      let placedChunk = false;
      for (const date of dates) {
        if (!constraints.includeWeekends && isWeekend(date)) continue;
        if (date < today) continue;
        const week = weeks.get(weekStartOf(date));
        const dailyCap = Math.min(
          constraints.dailyCapacityMinutes,
          Math.max(0, (constraints.workdayEnd - constraints.workdayStart) * 60),
        );
        const plannedToday = plannedByDate.get(date) ?? 0;
        if (plannedToday + chunk > dailyCap) {
          failedReason = "Daily capacity reached";
          continue;
        }
        if (week && constraints.capBehavior === "stop" && week.actualMinutes + week.plannedMinutes + chunk > week.capMinutes) {
          failedReason = "Weekly capacity reached";
          continue;
        }
        const start = Math.max(
          constraints.workdayStart * 60,
          date === today ? dateToMinutes(constraints.now, constraints.timeZone) : 0,
        );
        const end = constraints.workdayEnd * 60;
        if (start >= end) continue;
        const after = afterMinuteByDate.get(date) ?? start;
        const free = freeIntervals(start, end, busyForDate(date, constraints));
        const slot = free.find((interval) => {
          const candidateStart = Math.max(interval.start, after);
          return candidateStart + chunk <= interval.end;
        });
        if (!slot) continue;
        const startMinute = Math.max(slot.start, after);
        const rounded = Math.ceil(startMinute / 5) * 5;
        if (rounded + chunk > slot.end) continue;
        blocks.push({
          taskId: task.id,
          title: task.title,
          priority: task.priority,
          date,
          startMinute: rounded,
          minutes: chunk,
          source: "auto",
          locked: false,
        });
        const nextAfter = rounded + chunk + Math.max(0, constraints.restMinutes);
        afterMinuteByDate.set(date, nextAfter);
        plannedByDate.set(date, plannedToday + chunk);
        if (week) week.plannedMinutes += chunk;
        placedAny = true;
        placedChunk = true;
        placedCount += 1;
        break;
      }
      if (!placedChunk) break;
    }
    if (!placedAny) {
      unscheduled.push({ taskId: task.id, title: task.title, reason: failedReason });
    } else if (placedCount < chunks.length) {
      unscheduled.push({
        taskId: task.id,
        title: task.title,
        reason: `Only ${placedCount} of ${chunks.length} sessions fit before the horizon`,
      });
    }
  }

  for (const week of weeks.values()) {
    if (week.actualMinutes + week.plannedMinutes > week.capMinutes) {
      warnings.push(`Week of ${[...weeks.entries()].find(([, value]) => value === week)?.[0] ?? ""} exceeds the weekly capacity by ${week.actualMinutes + week.plannedMinutes - week.capMinutes} minutes.`);
    }
  }
  if (needsEstimate) warnings.push(`${needsEstimate} task${needsEstimate === 1 ? "" : "s"} used the default estimate.`);
  if (unscheduled.length) warnings.push(`${unscheduled.length} task${unscheduled.length === 1 ? "" : "s"} could not be placed within the horizon.`);

  const scheduledMinutes = blocks.reduce((sum, block) => sum + block.minutes, 0);
  const overCap = [...weeks.values()].some((week) => week.actualMinutes + week.plannedMinutes > week.capMinutes);
  return {
    id,
    blocks,
    unscheduled,
    scheduledMinutes,
    weeks: [...weeks.entries()].map(([weekStart, week]) => ({
      weekStart,
      actualMinutes: week.actualMinutes,
      plannedMinutes: week.plannedMinutes,
      capMinutes: week.capMinutes,
      over: week.actualMinutes + week.plannedMinutes > week.capMinutes,
    })),
    warnings,
    overCap,
    needsEstimate,
  };
}

export function buildAutoPlan(tasks: AutoPlanTask[], constraints: AutoPlanConstraints): AutoPlanPreview {
  const horizonDays = Math.max(1, Math.min(MAX_HORIZON, Math.round(constraints.horizonDays)));
  const dates = weekDates(constraints.startDate, horizonDays);
  return {
    startDate: constraints.startDate,
    horizonDays,
    weeklyCapacityMinutes: constraints.weeklyCapacityMinutes,
    generatedAt: constraints.now.toISOString(),
    options: (["balanced", "focus", "light"] as const).map((id) => buildOption(id, tasks, constraints, dates)),
  };
}

export function localDateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}
