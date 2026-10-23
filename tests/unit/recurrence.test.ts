import { describe, expect, it } from "vitest";
import { describeRecurrence, nextOccurrence, parseRecurrence, recurrenceEndsAtFromRule, serializeRecurrence } from "@/lib/recurrence";
import { localDateTimeUtc } from "@/lib/time";

describe("recurrence engine (FR-007)", () => {
  it("parses and serializes canonical rules", () => {
    expect(parseRecurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=6")).toEqual({
      frequency: "WEEKLY",
      interval: 2,
      byDay: [1, 4],
      count: 6,
    });
    expect(serializeRecurrence({ frequency: "MONTHLY", interval: 1 })).toBe("FREQ=MONTHLY;INTERVAL=1");
    expect(parseRecurrence("FREQ=YEARLY")).toBeNull();
    expect(describeRecurrence("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE")).toBe("Every Mon, Wed");
  });

  it("keeps 9am local across the spring DST transition", () => {
    const start = localDateTimeUtc("2026-03-07", 9, 0, "America/New_York");
    const next = nextOccurrence("FREQ=DAILY;INTERVAL=1", start, "America/New_York", false);
    expect(next?.toISOString()).toBe("2026-03-08T13:00:00.000Z"); // 09:00 EDT, not 10:00.
  });

  it("keeps all-day recurring tasks at local noon", () => {
    const start = localDateTimeUtc("2026-10-24", 12, 0, "America/New_York");
    const next = nextOccurrence("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO", start, "America/New_York", true);
    expect(next?.toISOString()).toBe("2026-10-26T16:00:00.000Z");
  });

  it("supports monthly clamping and an end boundary", () => {
    const start = localDateTimeUtc("2026-01-31", 10, 0, "Europe/London");
    const next = nextOccurrence("FREQ=MONTHLY;INTERVAL=1", start, "Europe/London", false);
    expect(next?.toISOString()).toBe("2026-02-28T10:00:00.000Z");
    const end = localDateTimeUtc("2026-02-27", 23, 0, "Europe/London");
    expect(nextOccurrence("FREQ=MONTHLY;INTERVAL=1", start, "Europe/London", false, end)).toBeNull();
  });

  it("computes the final occurrence of a counted rule", () => {
    const start = localDateTimeUtc("2026-10-23", 9, 0, "UTC");
    const end = recurrenceEndsAtFromRule("FREQ=DAILY;INTERVAL=1;COUNT=3", start, "UTC");
    expect(end?.toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });
});
