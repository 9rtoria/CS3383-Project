import { describe, expect, it } from "vitest";
import { capacitySummary, rankTodayTasks, type TodayCandidate } from "@/lib/today";

const NOW = new Date("2026-10-23T15:00:00.000Z"); // 11:00 New York.

function candidate(overrides: Partial<TodayCandidate>): TodayCandidate {
  return {
    id: "t1",
    title: "Task",
    priority: "none",
    estimateMinutes: 30,
    dueDate: null,
    focusDate: null,
    completedAt: null,
    openDependencies: 0,
    ...overrides,
  };
}

describe("Today ranking (SX-2, FR-005)", () => {
  it("ranks overdue and explicitly focused work first with a reason", () => {
    const suggestions = rankTodayTasks(
      [
        candidate({ id: "plain", title: "Plain" }),
        candidate({ id: "overdue", title: "Overdue", dueDate: "2026-10-20T16:00:00.000Z", priority: "medium" }),
        candidate({ id: "focused", title: "Focused", focusDate: "2026-10-23" }),
      ],
      { timeZone: "America/New_York", capacityMinutes: 180, now: NOW },
    );
    expect(suggestions[0]!.id).toBe("overdue");
    expect(suggestions[0]!.reason).toContain("Overdue");
    expect(suggestions.find((task) => task.id === "focused")!.reason).toBe("You chose this for today");
    expect(suggestions.every((task) => task.reason.length > 0)).toBe(true);
  });

  it("never auto-selects blocked or completed work", () => {
    const suggestions = rankTodayTasks(
      [
        candidate({ id: "blocked", openDependencies: 1, priority: "urgent" }),
        candidate({ id: "done", completedAt: "2026-10-23T10:00:00.000Z" }),
        candidate({ id: "archived", archivedAt: "2026-10-23T10:00:00.000Z" }),
        candidate({ id: "ready" }),
      ],
      { timeZone: "America/New_York", capacityMinutes: 30, now: NOW },
    );
    expect(suggestions.map((task) => task.id).sort()).toEqual(["blocked", "ready"]);
    expect(suggestions.find((task) => task.id === "blocked")!.selected).toBe(false);
    expect(suggestions.find((task) => task.id === "blocked")!.blocked).toBe(true);
    expect(suggestions.find((task) => task.id === "ready")!.selected).toBe(true);
  });

  it("fills capacity deterministically and reports overflow", () => {
    const suggestions = rankTodayTasks(
      [
        candidate({ id: "a", priority: "high", estimateMinutes: 45 }),
        candidate({ id: "b", priority: "medium", estimateMinutes: 45 }),
        candidate({ id: "c", priority: "low", estimateMinutes: 30 }),
      ],
      { timeZone: "UTC", capacityMinutes: 75, now: NOW },
    );
    const summary = capacitySummary(suggestions, 75);
    expect(summary.selectedCount).toBe(2);
    expect(summary.selectedMinutes).toBe(75);
    expect(summary.remainingMinutes).toBe(0);
    expect(summary.overflowCount).toBe(1);
    expect(summary.utilization).toBe(100);
  });
});
