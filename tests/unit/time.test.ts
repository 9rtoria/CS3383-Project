import { describe, expect, it } from "vitest";
import {
  addDaysToDateString,
  addMonthsToDateString,
  dateStringInTimeZone,
  endOfLocalDayUtc,
  isValidTimeZone,
  localDateTimeUtc,
  monthGridStart,
  partsInTimeZone,
  safeTimeZone,
  todayInTimeZone,
  weekdayOfDateString,
  zonedTimeToUtc,
} from "@/lib/time";

describe("timezone and DST helpers (FR-007, NFR-009)", () => {
  it("round-trips a wall-clock time through a zone", () => {
    const instant = localDateTimeUtc("2026-10-23", 14, 30, "America/New_York");
    expect(instant.toISOString()).toBe("2026-10-23T18:30:00.000Z");
    expect(partsInTimeZone(instant, "America/New_York")).toMatchObject({ hour: 14, minute: 30 });
  });

  it("handles the spring-forward gap deterministically", () => {
    // 02:30 does not exist in New York on 2026-03-08; Intl resolves it to 03:30 EDT.
    const instant = zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York");
    expect(instant.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(partsInTimeZone(instant, "America/New_York").hour).toBe(3);
  });

  it("handles the autumn fold without shifting the calendar date", () => {
    const instant = localDateTimeUtc("2026-11-01", 1, 30, "America/New_York");
    expect(dateStringInTimeZone(instant, "America/New_York")).toBe("2026-11-01");
    expect(partsInTimeZone(instant, "America/New_York").minute).toBe(30);
  });

  it("clamps month arithmetic at the end of a month", () => {
    expect(addMonthsToDateString("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDateString("2026-02-28", 1)).toBe("2026-03-28");
    expect(addDaysToDateString("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOfDateString("2026-10-23")).toBe(5);
  });

  it("calculates local day boundaries and validates zones", () => {
    expect(todayInTimeZone("Pacific/Auckland", new Date("2026-10-23T12:00:00Z"))).toBe("2026-10-24");
    expect(endOfLocalDayUtc("2026-10-23", "UTC").toISOString()).toBe("2026-10-23T23:59:59.000Z");
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(safeTimeZone("Not/AZone", "UTC")).toBe("UTC");
  });

  it("builds a Monday-first calendar grid", () => {
    expect(monthGridStart(2026, 10)).toBe("2026-09-28");
  });
});
