import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  formatHourWithPreference,
  normalizePreferences,
  parseFeatures,
  resolveTheme,
  serializeFeatures,
} from "@/lib/preferences";

describe("personalization preferences", () => {
  it("uses calm defaults for a new account", () => {
    const prefs = normalizePreferences(null);
    expect(prefs).toMatchObject({
      theme: "system",
      density: "comfortable",
      locale: "en",
      readingSize: "default",
      displayFont: "editorial",
      accent: "moss",
      motion: "system",
      startView: "today",
      capacityMinutes: 300,
      planBufferPercent: 0,
      workdayStart: 9,
      workdayEnd: 18,
      focusMinutes: 25,
      focusAutoStart: false,
      captureCloseAfterAdd: true,
    });
    expect(prefs.features).toEqual({ dayFlow: true, smartPlan: true, voice: true });
  });

  it("clamps or falls back instead of trusting stored strings", () => {
    const prefs = normalizePreferences({
      theme: "neon",
      density: "tiny",
      accent: "purple",
      motion: "jitter",
      startView: "somewhere",
      capacityMinutes: 9000,
      planBufferPercent: -4,
      focusMinutes: 2,
      workdayStart: 20,
      workdayEnd: 8,
    } as never);
    expect(prefs.theme).toBe(DEFAULT_PREFERENCES.theme);
    expect(prefs.density).toBe(DEFAULT_PREFERENCES.density);
    expect(prefs.accent).toBe(DEFAULT_PREFERENCES.accent);
    expect(prefs.motion).toBe(DEFAULT_PREFERENCES.motion);
    expect(prefs.startView).toBe(DEFAULT_PREFERENCES.startView);
    expect(prefs.capacityMinutes).toBe(1440);
    expect(prefs.planBufferPercent).toBe(0);
    expect(prefs.focusMinutes).toBe(5);
    expect(prefs.workdayEnd).toBeGreaterThan(prefs.workdayStart);
  });

  it("parses feature flags safely", () => {
    expect(parseFeatures(undefined)).toEqual(DEFAULT_PREFERENCES.features);
    expect(parseFeatures("{bad json")).toEqual(DEFAULT_PREFERENCES.features);
    expect(parseFeatures(JSON.stringify({ dayFlow: false, voice: false }))).toEqual({
      dayFlow: false,
      smartPlan: true,
      voice: false,
    });
    expect(JSON.parse(serializeFeatures({ dayFlow: true, smartPlan: false, voice: true }))).toEqual({
      dayFlow: true,
      smartPlan: false,
      voice: true,
    });
  });

  it("resolves system theme without changing the stored preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("formats hour previews using locale and explicit time format", () => {
    expect(formatHourWithPreference(17, { timeFormat: "auto", locale: "en" })).toBe("5:00 PM");
    expect(formatHourWithPreference(17, { timeFormat: "auto", locale: "zh-TW" })).toBe("17:00");
    expect(formatHourWithPreference(0, { timeFormat: "24", locale: "en" })).toBe("00:00");
    expect(formatHourWithPreference(12, { timeFormat: "12", locale: "zh-TW" })).toBe("12:00 PM");
  });
});
