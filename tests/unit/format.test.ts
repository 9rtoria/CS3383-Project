import { describe, expect, it } from "vitest";
import { appLocale, formatDate, formatTime } from "@/lib/format";

describe("date formatting follows the app language", () => {
  it("defaults to English on the server, regardless of the OS locale", () => {
    expect(appLocale()).toBe("en-US");
    expect(formatDate("2026-10-24T12:00:00", { month: "short", day: "numeric" })).toBe("Oct 24");
    expect(formatTime("2026-10-24T18:00:00")).toBe("6:00 PM");
  });
});
