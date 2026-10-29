import { describe, expect, it } from "vitest";
import { buildAutoPlan, weekStartOf, type AutoPlanConstraints, type AutoPlanTask } from "@/lib/auto-plan";

const START = "2026-10-26"; // Monday

function task(overrides: Partial<AutoPlanTask> & { id: string }): AutoPlanTask {
  return {
    title: overrides.id,
    priority: "medium",
    dueDate: null,
    estimateMinutes: 60,
    actualMinutes: null,
    focusDate: null,
    completedAt: null,
    openDependencies: 0,
    updatedAt: "2026-10-01T09:00:00.000Z",
    ...overrides,
  };
}

function constraints(overrides: Partial<AutoPlanConstraints> = {}): AutoPlanConstraints {
  return {
    startDate: START,
    horizonDays: 7,
    timeZone: "UTC",
    now: new Date("2026-10-26T08:00:00.000Z"),
    workdayStart: 9,
    workdayEnd: 18,
    dailyCapacityMinutes: 600,
    weeklyCapacityMinutes: 1500,
    restMinutes: 10,
    deepWorkMinutes: 90,
    splitLongTasks: true,
    includeWeekends: false,
    defaultEstimateMinutes: 30,
    capBehavior: "stop",
    lunchEnabled: true,
    lunchStart: 12,
    lunchEnd: 13,
    existingBlocks: [],
    actualMinutesByWeek: {},
    ...overrides,
  };
}

describe("Auto-plan scheduler", () => {
  it("places blocks in the workday with rest between them", () => {
    const preview = buildAutoPlan([
      task({ id: "a", title: "Write", estimateMinutes: 60 }),
      task({ id: "b", title: "Review", estimateMinutes: 30 }),
    ], constraints());
    const balanced = preview.options.find((option) => option.id === "balanced")!;
    expect(balanced.blocks).toHaveLength(2);
    expect(balanced.blocks[0]).toMatchObject({ date: START, startMinute: 9 * 60, minutes: 60 });
    expect(balanced.blocks[1]).toMatchObject({ date: START, startMinute: 10 * 60 + 10, minutes: 30 });
    expect(balanced.scheduledMinutes).toBe(90);
    expect(balanced.unscheduled).toEqual([]);
  });

  it("splits long work into sessions with rest", () => {
    const preview = buildAutoPlan([
      task({ id: "long", title: "Deep work", estimateMinutes: 120 }),
    ], constraints({ deepWorkMinutes: 45, splitLongTasks: true }));
    const balanced = preview.options.find((option) => option.id === "balanced")!;
    expect(balanced.blocks.map((block) => block.minutes)).toEqual([45, 45, 30]);
    expect(balanced.blocks).toHaveLength(3);
  });

  it("does not schedule beyond the weekly limit", () => {
    const tasks = [
      task({ id: "a", title: "A", estimateMinutes: 60 }),
      task({ id: "b", title: "B", estimateMinutes: 60 }),
      task({ id: "c", title: "C", estimateMinutes: 60 }),
    ];
    const preview = buildAutoPlan(tasks, constraints({ weeklyCapacityMinutes: 120, dailyCapacityMinutes: 600 }));
    const balanced = preview.options.find((option) => option.id === "balanced")!;
    expect(balanced.blocks).toHaveLength(2);
    expect(balanced.unscheduled.some((entry) => entry.taskId === "c")).toBe(true);
    expect(balanced.unscheduled.find((entry) => entry.taskId === "c")?.reason).toContain("Weekly");
  });

  it("counts completed actual minutes against the week", () => {
    const preview = buildAutoPlan([task({ id: "a", title: "A", estimateMinutes: 60 })], constraints({
      weeklyCapacityMinutes: 100,
      actualMinutesByWeek: { [weekStartOf(START)]: 110 },
    }));
    const balanced = preview.options.find((option) => option.id === "balanced")!;
    expect(balanced.blocks).toHaveLength(0);
    expect(balanced.unscheduled[0]?.reason).toContain("Weekly");
    expect(balanced.overCap).toBe(true);
  });

  it("keeps fixed blocks and lunch out of the available window", () => {
    const preview = buildAutoPlan([task({ id: "a", title: "A", estimateMinutes: 60 })], constraints({
      existingBlocks: [{ taskId: "fixed", title: "Fixed", date: START, startMinute: 9 * 60, minutes: 60, source: "manual", locked: true }],
    }));
    const balanced = preview.options.find((option) => option.id === "balanced")!;
    expect(balanced.blocks[0]?.startMinute).toBe(10 * 60);
  });

  it("does not schedule blocked tasks", () => {
    const preview = buildAutoPlan([task({ id: "blocked", openDependencies: 1 })], constraints());
    const balanced = preview.options.find((option) => option.id === "balanced")!;
    expect(balanced.blocks).toHaveLength(0);
    expect(balanced.unscheduled[0]?.taskId).toBe("blocked");
  });

  it("keeps the light option focused on urgent or soon work", () => {
    const preview = buildAutoPlan([
      task({ id: "low", priority: "low", estimateMinutes: 30 }),
      task({ id: "urgent", priority: "urgent", estimateMinutes: 30 }),
    ], constraints());
    const light = preview.options.find((option) => option.id === "light")!;
    expect(light.blocks.map((block) => block.taskId)).toEqual(["urgent"]);
  });

  it("skips weekends unless enabled", () => {
    const friday = "2026-10-30";
    const tasks = [
      task({ id: "a", estimateMinutes: 300 }),
      task({ id: "b", estimateMinutes: 300 }),
    ];
    const without = buildAutoPlan(tasks, constraints({ startDate: friday, horizonDays: 3, includeWeekends: false }));
    const withWeekends = buildAutoPlan(tasks, constraints({ startDate: friday, horizonDays: 3, includeWeekends: true }));
    expect(without.options[0]!.blocks.every((block) => block.date === friday)).toBe(true);
    expect(withWeekends.options[0]!.blocks.some((block) => block.date === "2026-10-31")).toBe(true);
  });
});
