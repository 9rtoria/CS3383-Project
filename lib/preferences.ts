/**
 * Client-side personalization helpers.
 *
 * The database is the source of truth for cross-device preferences. A small
 * localStorage mirror keeps the first paint from flashing the wrong theme or
 * language before /api/bootstrap resolves.
 */

import type { UserSettings } from "@/lib/types";

export type ThemeMode = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";
export type Locale = "en" | "zh-TW";
export type TimeFormat = "auto" | "12" | "24";
export type ReadingSize = "default" | "large";
export type DisplayFont = "editorial" | "modern" | "classic";
export type Accent = "moss" | "ink" | "clay";
export type MotionPreference = "system" | "reduced" | "full";
export type StartView = "today" | "board" | "upcoming";
export type AutoPlanMode = "suggest" | "safe" | "full" | "delegated";
export type AutoPlanCapBehavior = "stop" | "warn";

export type AutoPlanPreferences = {
  enabled: boolean;
  mode: AutoPlanMode;
  restMinutes: number;
  weeklyMinutes: number;
  refreshMinutes: number;
  deepWorkMinutes: number;
  splitLongTasks: boolean;
  includeWeekends: boolean;
  defaultEstimateMinutes: number;
  capBehavior: AutoPlanCapBehavior;
  lunchEnabled: boolean;
  lunchStart: number;
  lunchEnd: number;
  allowStaleArchive: boolean;
  staleDays: number;
};

export type FeaturePreferences = {
  dayFlow: boolean;
  smartPlan: boolean;
  voice: boolean;
};

export type SettingsPatch = Partial<UserSettings> & { timezone?: string };

export type Preferences = {
  theme: ThemeMode;
  density: Density;
  locale: Locale;
  timeFormat: TimeFormat;
  readingSize: ReadingSize;
  displayFont: DisplayFont;
  accent: Accent;
  motion: MotionPreference;
  startView: StartView;
  capacityMinutes: number;
  planBufferPercent: number;
  workdayStart: number;
  workdayEnd: number;
  blockBufferMinutes: number;
  focusMinutes: number;
  focusAutoStart: boolean;
  captureCloseAfterAdd: boolean;
  autoPlan: AutoPlanPreferences;
  features: FeaturePreferences;
};

export const DEFAULT_FEATURES: FeaturePreferences = {
  dayFlow: true,
  smartPlan: true,
  voice: true,
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  density: "comfortable",
  locale: "en",
  timeFormat: "auto",
  readingSize: "default",
  displayFont: "editorial",
  accent: "moss",
  motion: "system",
  startView: "today",
  capacityMinutes: 300,
  planBufferPercent: 0,
  workdayStart: 9,
  workdayEnd: 18,
  blockBufferMinutes: 0,
  focusMinutes: 25,
  focusAutoStart: false,
  captureCloseAfterAdd: true,
  autoPlan: {
    enabled: true,
    mode: "suggest",
    restMinutes: 10,
    weeklyMinutes: 1500,
    refreshMinutes: 30,
    deepWorkMinutes: 90,
    splitLongTasks: true,
    includeWeekends: false,
    defaultEstimateMinutes: 30,
    capBehavior: "stop",
    lunchEnabled: true,
    lunchStart: 12,
    lunchEnd: 13,
    allowStaleArchive: false,
    staleDays: 30,
  },
  features: DEFAULT_FEATURES,
};

export const THEME_STORAGE_KEY = "drift-theme";
export const LOCALE_STORAGE_KEY = "drift-locale";
export const TIME_FORMAT_STORAGE_KEY = "drift-time-format";

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

export function parseFeatures(raw: string | null | undefined): FeaturePreferences {
  if (!raw) return { ...DEFAULT_FEATURES };
  try {
    const parsed = JSON.parse(raw) as Partial<FeaturePreferences>;
    return {
      dayFlow: typeof parsed.dayFlow === "boolean" ? parsed.dayFlow : DEFAULT_FEATURES.dayFlow,
      smartPlan: typeof parsed.smartPlan === "boolean" ? parsed.smartPlan : DEFAULT_FEATURES.smartPlan,
      voice: typeof parsed.voice === "boolean" ? parsed.voice : DEFAULT_FEATURES.voice,
    };
  } catch {
    return { ...DEFAULT_FEATURES };
  }
}

export function serializeFeatures(features: FeaturePreferences): string {
  return JSON.stringify({
    dayFlow: Boolean(features.dayFlow),
    smartPlan: Boolean(features.smartPlan),
    voice: Boolean(features.voice),
  });
}

export function normalizePreferences(settings: Partial<UserSettings> | null | undefined): Preferences {
  const source = settings ?? {};
  const workdayStart = intIn(source.workdayStart, 0, 23, DEFAULT_PREFERENCES.workdayStart);
  const workdayEnd = intIn(source.workdayEnd, 1, 24, DEFAULT_PREFERENCES.workdayEnd);
  const lunchStart = intIn(source.autoPlanLunchStart, 0, 23, DEFAULT_PREFERENCES.autoPlan.lunchStart);
  const lunchEnd = intIn(source.autoPlanLunchEnd, 1, 24, DEFAULT_PREFERENCES.autoPlan.lunchEnd);
  return {
    theme: oneOf(source.theme, ["light", "dark", "system"] as const, DEFAULT_PREFERENCES.theme),
    density: oneOf(source.density, ["comfortable", "compact"] as const, DEFAULT_PREFERENCES.density),
    locale: oneOf(source.locale, ["en", "zh-TW"] as const, DEFAULT_PREFERENCES.locale),
    timeFormat: oneOf(source.timeFormat, ["auto", "12", "24"] as const, DEFAULT_PREFERENCES.timeFormat),
    readingSize: oneOf(source.readingSize, ["default", "large"] as const, DEFAULT_PREFERENCES.readingSize),
    displayFont: oneOf(source.displayFont, ["editorial", "modern", "classic"] as const, DEFAULT_PREFERENCES.displayFont),
    accent: oneOf(source.accent, ["moss", "ink", "clay"] as const, DEFAULT_PREFERENCES.accent),
    motion: oneOf(source.motion, ["system", "reduced", "full"] as const, DEFAULT_PREFERENCES.motion),
    startView: oneOf(source.startView, ["today", "board", "upcoming"] as const, DEFAULT_PREFERENCES.startView),
    capacityMinutes: intIn(source.capacityMinutes, 15, 1440, DEFAULT_PREFERENCES.capacityMinutes),
    planBufferPercent: intIn(source.planBufferPercent, 0, 50, DEFAULT_PREFERENCES.planBufferPercent),
    workdayStart,
    workdayEnd: Math.max(workdayStart + 1, workdayEnd),
    blockBufferMinutes: intIn(source.blockBufferMinutes, 0, 30, DEFAULT_PREFERENCES.blockBufferMinutes),
    focusMinutes: intIn(source.focusMinutes, 5, 180, DEFAULT_PREFERENCES.focusMinutes),
    focusAutoStart: typeof source.focusAutoStart === "boolean" ? source.focusAutoStart : DEFAULT_PREFERENCES.focusAutoStart,
    captureCloseAfterAdd: typeof source.captureCloseAfterAdd === "boolean" ? source.captureCloseAfterAdd : DEFAULT_PREFERENCES.captureCloseAfterAdd,
    autoPlan: {
      enabled: typeof source.autoPlanEnabled === "boolean" ? source.autoPlanEnabled : DEFAULT_PREFERENCES.autoPlan.enabled,
      mode: oneOf(source.autoPlanMode, ["suggest", "safe", "full", "delegated"] as const, DEFAULT_PREFERENCES.autoPlan.mode),
      restMinutes: intIn(source.autoPlanRestMinutes, 0, 60, DEFAULT_PREFERENCES.autoPlan.restMinutes),
      weeklyMinutes: intIn(source.autoPlanWeeklyMinutes, 60, 10080, DEFAULT_PREFERENCES.autoPlan.weeklyMinutes),
      refreshMinutes: source.autoPlanRefreshMinutes === 0 ? 0 : intIn(source.autoPlanRefreshMinutes, 15, 60, DEFAULT_PREFERENCES.autoPlan.refreshMinutes),
      deepWorkMinutes: intIn(source.autoPlanDeepWorkMinutes, 15, 240, DEFAULT_PREFERENCES.autoPlan.deepWorkMinutes),
      splitLongTasks: typeof source.autoPlanSplitLongTasks === "boolean" ? source.autoPlanSplitLongTasks : DEFAULT_PREFERENCES.autoPlan.splitLongTasks,
      includeWeekends: typeof source.autoPlanIncludeWeekends === "boolean" ? source.autoPlanIncludeWeekends : DEFAULT_PREFERENCES.autoPlan.includeWeekends,
      defaultEstimateMinutes: intIn(source.autoPlanDefaultEstimateMinutes, 5, 240, DEFAULT_PREFERENCES.autoPlan.defaultEstimateMinutes),
      capBehavior: oneOf(source.autoPlanCapBehavior, ["stop", "warn"] as const, DEFAULT_PREFERENCES.autoPlan.capBehavior),
      lunchEnabled: typeof source.autoPlanLunchEnabled === "boolean" ? source.autoPlanLunchEnabled : DEFAULT_PREFERENCES.autoPlan.lunchEnabled,
      lunchStart,
      lunchEnd: Math.max(lunchStart + 1, lunchEnd),
      allowStaleArchive: typeof source.autoPlanAllowStaleArchive === "boolean" ? source.autoPlanAllowStaleArchive : DEFAULT_PREFERENCES.autoPlan.allowStaleArchive,
      staleDays: intIn(source.autoPlanStaleDays, 1, 365, DEFAULT_PREFERENCES.autoPlan.staleDays),
    },
    features: parseFeatures(source.featuresJson),
  };
}

export function resolveTheme(theme: ThemeMode, prefersDark: boolean): "light" | "dark" {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function applyPreferencesToDocument(preferences: Preferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const theme = resolveTheme(preferences.theme, systemPrefersDark());
  root.dataset.theme = theme;
  root.dataset.themeMode = preferences.theme;
  root.dataset.density = preferences.density;
  root.dataset.displayFont = preferences.displayFont;
  root.dataset.readingSize = preferences.readingSize;
  root.dataset.accent = preferences.accent;
  root.dataset.motion = preferences.motion;
  root.dataset.locale = preferences.locale;
  root.lang = preferences.locale;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preferences.theme);
    localStorage.setItem(LOCALE_STORAGE_KEY, preferences.locale);
    localStorage.setItem(TIME_FORMAT_STORAGE_KEY, preferences.timeFormat);
  } catch {
    // Storage is a progressive enhancement; the app still works for this tab.
  }
}

export function formatHourWithPreference(hour: number, preferences: Pick<Preferences, "timeFormat" | "locale">): string {
  const safe = ((Math.round(hour) % 24) + 24) % 24;
  const use24 = preferences.timeFormat === "24" || (preferences.timeFormat === "auto" && preferences.locale === "zh-TW");
  if (use24) return `${String(safe).padStart(2, "0")}:00`;
  const suffix = safe >= 12 ? "PM" : "AM";
  const value = safe % 12 || 12;
  return `${value}:00 ${suffix}`;
}
