import { afterEach, describe, expect, it } from "vitest";
import { getLocale, setLocale, translate, translateReason, translatedKeys } from "@/lib/i18n";

afterEach(() => {
  setLocale("en");
});

describe("ProjectA2 translation layer", () => {
  it("keeps a complete core dictionary without duplicate keys", () => {
    const keys = translatedKeys();
    expect(keys.length).toBeGreaterThan(120);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining([
      "Settings",
      "Appearance",
      "Language & region",
      "Notifications",
      "Sound",
      "Day flow",
      "Begin focus",
      "What needs doing?",
    ]));
  });

  it("falls back to readable English instead of a raw key", () => {
    setLocale("zh-TW");
    expect(translate("Settings")).toBe("設定");
    expect(translate("This string is intentionally not translated yet.")).toBe("This string is intentionally not translated yet.");
  });

  it("replaces placeholders without dropping the count", () => {
    setLocale("zh-TW");
    expect(translate("{{count}} tasks chosen for today. Start with the first one; the rest can wait.", { count: 4 })).toContain("4");
  });

  it("translates the planner reasons while leaving unknown dynamic text alone", () => {
    setLocale("zh-TW");
    expect(translateReason("Due today", (key) => translate(key))).toBe("今天到期");
    expect(translateReason("Overdue since Oct 20", (key) => translate(key))).toContain("逾期自");
    expect(translateReason("A custom reason", (key) => translate(key))).toBe("A custom reason");
  });

  it("round-trips the locale setter", () => {
    setLocale("zh-TW");
    expect(getLocale()).toBe("zh-TW");
    setLocale("en");
    expect(getLocale()).toBe("en");
  });
});
