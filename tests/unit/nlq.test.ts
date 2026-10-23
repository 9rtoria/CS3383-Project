import { describe, expect, it } from "vitest";
import { formatDueLabel, parseQuickAdd } from "@/lib/nlq";

const NOW = new Date("2026-10-23T16:00:00.000Z"); // Fri 23 Oct 2026, 12:00 in New York.

describe("parseQuickAdd (SX-1, FR-003, FR-007)", () => {
  it("parses the advertised compact syntax without network access", () => {
    const parsed = parseQuickAdd("Draft launch note tomorrow 2pm !high #Work ~45m", NOW, "America/New_York");
    expect(parsed.title).toBe("Draft launch note");
    expect(parsed.priority).toBe("high");
    expect(parsed.labels).toEqual(["Work"]);
    expect(parsed.estimateMinutes).toBe(45);
    expect(parsed.dueAllDay).toBe(false);
    expect(parsed.dueDate).toBe("2026-10-24T18:00:00.000Z");
  });

  it("treats an all-day date as local noon and strips every token from the title", () => {
    const parsed = parseQuickAdd("Send invoice on 2026-11-02 !low #Admin", NOW, "America/New_York");
    expect(parsed.title).toBe("Send invoice");
    expect(parsed.priority).toBe("low");
    expect(parsed.dueAllDay).toBe(true);
    expect(parsed.dueDate).toBe("2026-11-02T17:00:00.000Z");
  });

  it("understands weekdays and recurrence", () => {
    const parsed = parseQuickAdd("Stand-up every Monday 9am", NOW, "America/New_York");
    expect(parsed.title).toBe("Stand-up");
    expect(parsed.recurrenceRule).toBe("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO");
    expect(parsed.dueDate).toBe("2026-10-26T13:00:00.000Z");
  });

  it("understands tonight as 8pm local", () => {
    const parsed = parseQuickAdd("Call Sam tonight", NOW, "America/New_York");
    expect(parsed.title).toBe("Call Sam");
    expect(parsed.dueAllDay).toBe(false);
    expect(parsed.dueDate).toBe("2026-10-24T00:00:00.000Z");
  });

  it("keeps plain language intact when no metadata is present", () => {
    const parsed = parseQuickAdd("Read the onboarding notes", NOW, "Europe/London");
    expect(parsed).toMatchObject({
      title: "Read the onboarding notes",
      priority: "none",
      labels: [],
      dueDate: undefined,
      dueAllDay: true,
    });
  });

  it("formats due labels relative to the supplied timezone", () => {
    expect(formatDueLabel("2026-10-23T17:00:00.000Z", true, "America/New_York", NOW)).toBe("Today");
    expect(formatDueLabel("2026-10-24T18:00:00.000Z", false, "America/New_York", NOW)).toBe("Tomorrow, 2:00 PM");
  });
});
