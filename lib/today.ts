import type { TaskPriority } from "./nlq";
import { dateStringInTimeZone, todayInTimeZone } from "./time";

export type TodayCandidate = {
  id: string;
  title: string;
  priority: TaskPriority | string;
  estimateMinutes: number | null;
  dueDate: Date | string | null;
  focusDate: string | null;
  completedAt: Date | string | null;
  archivedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  openDependencies?: number;
};

export type TodaySuggestion = TodayCandidate & {
  score: number;
  reason: string;
  suggestedMinutes: number;
  selected: boolean;
  blocked: boolean;
};

const PRIORITY_SCORE: Record<string, number> = { urgent: 50, high: 35, medium: 18, low: 8, none: 0 };

export function rankTodayTasks(
  tasks: TodayCandidate[],
  options: { timeZone: string; capacityMinutes: number; now?: Date },
): TodaySuggestion[] {
  const now = options.now ?? new Date();
  const today = todayInTimeZone(options.timeZone, now);

  const scored = tasks
    .filter((task) => !task.completedAt && !task.archivedAt && !task.deletedAt)
    .map((task) => {
      const dueDate = task.dueDate ? dateStringInTimeZone(new Date(task.dueDate), options.timeZone) : null;
      const isOverdue = Boolean(dueDate && dueDate < today);
      const isToday = dueDate === today;
      const isFocused = task.focusDate === today;
      const blocked = (task.openDependencies ?? 0) > 0;
      let score = PRIORITY_SCORE[String(task.priority)] ?? 0;
      if (isOverdue) score += 70;
      if (isToday) score += 45;
      if (isFocused) score += 60;
      if (blocked) score -= 100;
      if (!dueDate && !isFocused) score += 4;
      const suggestedMinutes = task.estimateMinutes ?? 30;
      let reason: string;
      if (blocked) reason = "Waiting on a task that is not done yet";
      else if (isOverdue) reason = `Overdue since ${dueDate}`;
      else if (isFocused) reason = "You chose this for today";
      else if (isToday) reason = "Due today";
      else if (String(task.priority) === "urgent" || String(task.priority) === "high")
        reason = `${String(task.priority)[0]!.toUpperCase()}${String(task.priority).slice(1)} priority with no due date`;
      else if (task.estimateMinutes && task.estimateMinutes <= 20) reason = "A quick win to build momentum";
      else reason = "Next best use of your available time";
      return { ...task, score, reason, suggestedMinutes, selected: false, blocked };
    })
    .sort((a, b) => b.score - a.score || a.suggestedMinutes - b.suggestedMinutes);

  let remaining = Math.max(15, options.capacityMinutes);
  for (const task of scored) {
    if (task.blocked) continue;
    if (task.suggestedMinutes <= remaining) {
      task.selected = true;
      remaining -= task.suggestedMinutes;
    }
  }
  return scored;
}

export function capacitySummary(suggestions: TodaySuggestion[], capacity: number) {
  const selected = suggestions.filter((item) => item.selected);
  const minutes = selected.reduce((sum, item) => sum + item.suggestedMinutes, 0);
  const focusScore = selected.filter((item) => item.priority === "high" || item.priority === "urgent").length;
  return {
    selectedCount: selected.length,
    selectedMinutes: minutes,
    capacityMinutes: capacity,
    remainingMinutes: Math.max(0, capacity - minutes),
    utilization: capacity > 0 ? Math.min(100, Math.round((minutes / capacity) * 100)) : 0,
    overflowCount: suggestions.filter((item) => !item.selected && !item.blocked).length,
    focusScore,
  };
}
