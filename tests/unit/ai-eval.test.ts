import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "@/lib/nlq";
import { rankTodayTasks, type TodayCandidate } from "@/lib/today";

/**
 * AI governance evaluation fixture (brief §4.6).
 *
 * These are labelled, deterministic regression scenarios for the two shipped
 * assistive features. The heuristics are local: no task text leaves the server.
 * The bar is 20/20 per feature; a change that drops below the bar fails CI.
 */
const NOW = new Date("2026-10-23T16:00:00.000Z"); // Fri 23 Oct 2026, 12:00 New York.
const TZ = "America/New_York";

type QuickAddCase = {
  name: string;
  input: string;
  title: string;
  priority?: string;
  labels?: string[];
  estimateMinutes?: number;
  dueDate?: string;
  dueAllDay?: boolean;
  recurrenceRule?: string;
};

const quickAddCases: QuickAddCase[] = [
  { name: "plain language", input: "Read the onboarding notes", title: "Read the onboarding notes" },
  { name: "tomorrow all-day", input: "Send the deck tomorrow", title: "Send the deck", dueDate: "2026-10-24T16:00:00.000Z", dueAllDay: true },
  { name: "today all-day", input: "Plan the week today", title: "Plan the week", dueDate: "2026-10-23T16:00:00.000Z", dueAllDay: true },
  { name: "tonight is 8pm", input: "Call Sam tonight", title: "Call Sam", dueDate: "2026-10-24T00:00:00.000Z", dueAllDay: false },
  { name: "weekday", input: "Stand-up Monday", title: "Stand-up", dueDate: "2026-10-26T16:00:00.000Z", dueAllDay: true },
  { name: "next weekday", input: "Review next Monday", title: "Review", dueDate: "2026-10-26T16:00:00.000Z", dueAllDay: true },
  { name: "relative days", input: "File expenses in 3 days", title: "File expenses", dueDate: "2026-10-26T16:00:00.000Z", dueAllDay: true },
  { name: "relative weeks across DST", input: "Book venue in 2 weeks", title: "Book venue", dueDate: "2026-11-06T17:00:00.000Z", dueAllDay: true },
  { name: "ISO date", input: "Ship v1 on 2026-11-02", title: "Ship v1", dueDate: "2026-11-02T17:00:00.000Z", dueAllDay: true },
  { name: "month name", input: "Send invoice Oct 30", title: "Send invoice", dueDate: "2026-10-30T16:00:00.000Z", dueAllDay: true },
  { name: "month name with year boundary", input: "Buy gifts Dec 25", title: "Buy gifts", dueDate: "2026-12-25T17:00:00.000Z", dueAllDay: true },
  { name: "priority token", input: "Escalate !urgent", title: "Escalate", priority: "urgent" },
  { name: "label and low priority", input: "Buy milk !low #Home", title: "Buy milk", priority: "low", labels: ["Home"] },
  { name: "minute estimate", input: "Tidy desk ~15m", title: "Tidy desk", estimateMinutes: 15 },
  { name: "hour estimate", input: "Deep work ~1.5h", title: "Deep work", estimateMinutes: 90 },
  { name: "daily recurrence", input: "Stretch every day", title: "Stretch", dueDate: "2026-10-23T16:00:00.000Z", recurrenceRule: "FREQ=DAILY;INTERVAL=1" },
  { name: "fortnightly recurrence", input: "Team sync every 2 weeks", title: "Team sync", dueDate: "2026-11-06T17:00:00.000Z", recurrenceRule: "FREQ=WEEKLY;INTERVAL=2" },
  { name: "weekday recurrence", input: "Inbox zero every weekday", title: "Inbox zero", dueDate: "2026-10-26T16:00:00.000Z", recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  { name: "weekly timed recurrence", input: "Weekly review every Friday 9am", title: "Weekly review", dueDate: "2026-10-23T13:00:00.000Z", dueAllDay: false, recurrenceRule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=FR" },
  { name: "combined capture", input: "Draft launch note tomorrow 2pm !high #Work ~45m", title: "Draft launch note", priority: "high", labels: ["Work"], estimateMinutes: 45, dueDate: "2026-10-24T18:00:00.000Z", dueAllDay: false },
];

describe("AI evaluation: quick-add assist (SX-1, §4.6)", () => {
  it.each(quickAddCases)("$name", (testCase) => {
    const parsed = parseQuickAdd(testCase.input, NOW, TZ);
    expect(parsed.title).toBe(testCase.title);
    if (testCase.priority) expect(parsed.priority).toBe(testCase.priority);
    if (testCase.labels) expect(parsed.labels).toEqual(testCase.labels);
    if (testCase.estimateMinutes) expect(parsed.estimateMinutes).toBe(testCase.estimateMinutes);
    if (testCase.dueDate) expect(parsed.dueDate).toBe(testCase.dueDate);
    if (testCase.dueAllDay !== undefined) expect(parsed.dueAllDay).toBe(testCase.dueAllDay);
    if (testCase.recurrenceRule) expect(parsed.recurrenceRule).toBe(testCase.recurrenceRule);
  });
});

function candidate(id: string, overrides: Partial<TodayCandidate> = {}): TodayCandidate {
  return {
    id,
    title: id,
    priority: "none",
    estimateMinutes: 30,
    dueDate: null,
    focusDate: null,
    completedAt: null,
    openDependencies: 0,
    ...overrides,
  };
}

type TodayCase = {
  name: string;
  tasks: TodayCandidate[];
  capacity: number;
  selected: string[];
  topReason?: string;
};

const todayCases: TodayCase[] = [
  { name: "empty list", tasks: [], capacity: 300, selected: [] },
  {
    name: "overdue first with a reason",
    tasks: [candidate("plain"), candidate("overdue", { dueDate: "2026-10-20T16:00:00.000Z" })],
    capacity: 60,
    selected: ["overdue", "plain"],
    topReason: "Overdue since",
  },
  {
    name: "explicit focus first",
    tasks: [candidate("overdue", { dueDate: "2026-10-20T16:00:00.000Z" }), candidate("focused", { focusDate: "2026-10-23", priority: "high" })],
    capacity: 60,
    selected: ["focused", "overdue"],
    topReason: "You chose this for today",
  },
  {
    name: "due today beats undated high priority",
    tasks: [candidate("high", { priority: "high" }), candidate("today", { dueDate: "2026-10-23T20:00:00.000Z", priority: "low" })],
    capacity: 60,
    selected: ["today", "high"],
    topReason: "Due today",
  },
  {
    name: "urgent outranks other priorities",
    tasks: [candidate("low", { priority: "low" }), candidate("urgent", { priority: "urgent" }), candidate("high", { priority: "high" })],
    capacity: 30,
    selected: ["urgent"],
    topReason: "Urgent priority",
  },
  {
    name: "quick win reason",
    tasks: [candidate("plain"), candidate("quick", { priority: "low", estimateMinutes: 15 })],
    capacity: 15,
    selected: ["quick"],
    topReason: "quick win",
  },
  {
    name: "blocked work never auto-selects",
    tasks: [candidate("blocked", { priority: "urgent", openDependencies: 1 }), candidate("plain")],
    capacity: 60,
    selected: ["plain"],
    topReason: "Next best",
  },
  { name: "completed excluded", tasks: [candidate("done", { completedAt: "2026-10-23T10:00:00.000Z" })], capacity: 60, selected: [] },
  { name: "archived excluded", tasks: [candidate("archived", { archivedAt: "2026-10-22T10:00:00.000Z" })], capacity: 60, selected: [] },
  { name: "deleted excluded", tasks: [candidate("deleted", { deletedAt: "2026-10-22T10:00:00.000Z" })], capacity: 60, selected: [] },
  {
    name: "fills remaining capacity",
    tasks: [candidate("high", { priority: "high", estimateMinutes: 45 }), candidate("medium", { priority: "medium", estimateMinutes: 45 }), candidate("low", { priority: "low", estimateMinutes: 30 })],
    capacity: 75,
    selected: ["high", "low"],
  },
  { name: "missing estimate defaults to 30", tasks: [candidate("unknown", { estimateMinutes: null })], capacity: 30, selected: ["unknown"] },
  { name: "minimum planning window is 15 minutes", tasks: [candidate("tiny", { estimateMinutes: 15 })], capacity: 5, selected: ["tiny"] },
  { name: "exact capacity fit", tasks: [candidate("exact", { estimateMinutes: 60 })], capacity: 60, selected: ["exact"] },
  {
    name: "overflow stays unselected",
    tasks: [candidate("large", { priority: "high", estimateMinutes: 60 }), candidate("small", { priority: "low", estimateMinutes: 30 })],
    capacity: 60,
    selected: ["large"],
  },
  {
    name: "priority order is deterministic",
    tasks: [candidate("medium", { priority: "medium", estimateMinutes: 10 }), candidate("low", { priority: "low", estimateMinutes: 10 }), candidate("urgent", { priority: "urgent", estimateMinutes: 10 }), candidate("high", { priority: "high", estimateMinutes: 10 })],
    capacity: 15,
    selected: ["urgent"],
  },
  {
    name: "due today beats undated high",
    tasks: [candidate("high", { priority: "high" }), candidate("today", { priority: "low", dueDate: "2026-10-23T23:00:00.000Z" })],
    capacity: 60,
    selected: ["today", "high"],
    topReason: "Due today",
  },
  {
    name: "focused high beats overdue unprioritised",
    tasks: [candidate("overdue", { dueDate: "2026-10-20T16:00:00.000Z" }), candidate("focus", { focusDate: "2026-10-23", priority: "high" })],
    capacity: 60,
    selected: ["focus", "overdue"],
    topReason: "You chose this for today",
  },
  {
    name: "blocked remains visible but last",
    tasks: [candidate("blocked", { priority: "urgent", openDependencies: 1 }), candidate("plain")],
    capacity: 30,
    selected: ["plain"],
  },
  {
    name: "equal scores break ties by shorter estimate",
    tasks: [candidate("long", { estimateMinutes: 30 }), candidate("short", { estimateMinutes: 10 })],
    capacity: 60,
    selected: ["short", "long"],
  },
];

describe("AI evaluation: Today plan assist (SX-2, SX-5, §4.6)", () => {
  it.each(todayCases)("$name", (testCase) => {
    const ranked = rankTodayTasks(testCase.tasks, { timeZone: TZ, capacityMinutes: testCase.capacity, now: NOW });
    expect(ranked.filter((task) => task.selected).map((task) => task.id)).toEqual(testCase.selected);
    expect(ranked.every((task) => task.reason.trim().length > 0)).toBe(true);
    if (testCase.topReason) expect(ranked[0]!.reason).toContain(testCase.topReason);
  });
});
