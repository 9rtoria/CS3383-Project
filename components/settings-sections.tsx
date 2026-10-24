"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Clock3, Monitor, Moon, RotateCcw, Sparkles, SunMedium } from "lucide-react";
import { Toggle } from "@/components/ui";
import {
  DEFAULT_PREFERENCES,
  formatHourWithPreference,
  normalizePreferences,
  parseFeatures,
  serializeFeatures,
  type SettingsPatch,
} from "@/lib/preferences";
import { useI18n } from "@/lib/i18n";
import type { UserSettings } from "@/lib/types";

type SectionProps = {
  settings: UserSettings;
  onPatch: (patch: SettingsPatch) => void;
  onReset: (section: ResetSection) => void;
};

export type ResetSection = "appearance" | "language" | "planning" | "focus" | "features";

function SectionHeader({ title, description, onReset }: { title: string; description: string; onReset?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="settings-section-head">
      <div>
        <h2>{t(title)}</h2>
        <p>{t(description)}</p>
      </div>
      {onReset ? (
        <button type="button" className="btn ghost sm" onClick={onReset}>
          <RotateCcw size={12} aria-hidden /> {t("Restore defaults")}
        </button>
      ) : null}
    </div>
  );
}

function Row({ title, description, children, hint }: { title: string; description: string; children: ReactNode; hint?: string }) {
  const { t } = useI18n();
  return (
    <div className="settings-row">
      <div className="settings-copy">
        <strong>{t(title)}</strong>
        <span>{t(description)}</span>
        {hint ? <small className="field-hint">{t(hint)}</small> : null}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="settings-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "active" : ""}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ThemeChoice({
  value,
  current,
  label,
  onClick,
  icon,
}: {
  value: string;
  current: string;
  label: string;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`settings-theme-card${current === value ? " active" : ""}`}
      aria-pressed={current === value}
      onClick={onClick}
    >
      <span className={`settings-theme-visual ${value}`} aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span>{icon}{label}</span>
      {current === value ? <Check size={12} className="settings-check" aria-hidden /> : null}
    </button>
  );
}

export function AppearanceSettings({ settings, onPatch, onReset }: SectionProps) {
  const { t } = useI18n();
  return (
    <section className="settings-section" id="appearance" aria-labelledby="appearance-title">
      <SectionHeader
        title={t("Appearance")}
        description="Calm by default. Choose the material, type, and motion that fit your desk."
        onReset={() => onReset("appearance")}
      />
      <div className="settings-card">
        <Row title={t("Theme")} description="Follow your system, or pin a mode for this account.">
          <div className="settings-theme-grid">
            <ThemeChoice value="system" current={settings.theme} label={t("System")} onClick={() => onPatch({ theme: "system" })} icon={<Monitor size={13} aria-hidden />} />
            <ThemeChoice value="light" current={settings.theme} label={t("Light")} onClick={() => onPatch({ theme: "light" })} icon={<SunMedium size={13} aria-hidden />} />
            <ThemeChoice value="dark" current={settings.theme} label={t("Dark")} onClick={() => onPatch({ theme: "dark" })} icon={<Moon size={13} aria-hidden />} />
          </div>
        </Row>
        <Row title={t("Accent")} description="A quiet color for actions, focus, and the plan ring.">
          <div className="settings-swatches" role="group" aria-label={t("Accent")}>
            {[
              { value: "moss", label: t("Moss"), color: "#2f6b56" },
              { value: "ink", label: t("Ink"), color: "#3d5a80" },
              { value: "clay", label: t("Clay"), color: "#a35f43" },
            ].map((accent) => (
              <button
                key={accent.value}
                type="button"
                className={`settings-swatch${settings.accent === accent.value ? " active" : ""}`}
                aria-pressed={settings.accent === accent.value}
                onClick={() => onPatch({ accent: accent.value as "moss" | "ink" | "clay" })}
              >
                <span style={{ background: accent.color }} aria-hidden />
                {accent.label}
              </button>
            ))}
          </div>
        </Row>
        <Row title={t("Display type")} description="Editorial is the current serif voice. Modern uses the interface face.">
          <div className="settings-choice-grid settings-font-grid" role="group" aria-label={t("Display type")}>
            {[
              { value: "editorial", label: t("Editorial"), font: '"Iowan Old Style", "Palatino Linotype", Georgia, serif' },
              { value: "modern", label: t("Modern"), font: "var(--font-ui)" },
              { value: "classic", label: t("Classic"), font: '"Charter", Cambria, Georgia, serif' },
            ].map((font) => (
              <button
                key={font.value}
                type="button"
                className={`settings-choice${settings.displayFont === font.value ? " active" : ""}`}
                aria-pressed={settings.displayFont === font.value}
                onClick={() => onPatch({ displayFont: font.value as "editorial" | "modern" | "classic" })}
              >
                <span style={{ fontFamily: font.font }}>Aa</span>
                <small>{font.label}</small>
              </button>
            ))}
          </div>
        </Row>
        <Row title={t("Reading text")} description="A little more room for long notes and settings copy. Page zoom still works.">
          <Segmented
            label={t("Reading text")}
            value={settings.readingSize}
            onChange={(value) => onPatch({ readingSize: value as "default" | "large" })}
            options={[
              { value: "default", label: t("Default") },
              { value: "large", label: t("Large") },
            ]}
          />
        </Row>
        <Row title={t("Density")} description="Compact reduces row height in lists and settings without hiding information.">
          <Segmented
            label={t("Density")}
            value={settings.density}
            onChange={(value) => onPatch({ density: value as "comfortable" | "compact" })}
            options={[
              { value: "comfortable", label: t("Comfortable") },
              { value: "compact", label: t("Compact") },
            ]}
          />
        </Row>
        <Row title={t("Motion")} description="System respects your OS. Reduced keeps state changes instant. Full is for demos.">
          <Segmented
            label={t("Motion")}
            value={settings.motion}
            onChange={(value) => onPatch({ motion: value as "system" | "reduced" | "full" })}
            options={[
              { value: "system", label: t("System") },
              { value: "reduced", label: t("Reduced motion") },
              { value: "full", label: t("Full motion") },
            ]}
          />
        </Row>
      </div>
      <SettingsPreview settings={settings} />
    </section>
  );
}

export function SettingsPreview({ settings }: { settings: UserSettings }) {
  const { t } = useI18n();
  const preferences = normalizePreferences(settings);
  const dateLabel = new Intl.DateTimeFormat(preferences.locale, { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase();
  return (
    <div className="settings-preview-block" aria-label={t("Preview")}>
      <div className="settings-preview-head">
        <div>
          <span className="eyebrow"><Sparkles size={11} aria-hidden /> {t("Preview")}</span>
          <strong>{t("Today, at a glance")}</strong>
        </div>
        <span className="badge accent">4h 45m</span>
      </div>
      <div className="settings-live-preview">
        <div className="settings-preview-copy">
          <span className="eyebrow">{dateLabel}</span>
          <h3>{t("Good afternoon, Maya.")}</h3>
          <p>{t("Four small things, with room to breathe.")}</p>
        </div>
        <div className="settings-preview-plan" aria-hidden>
          <span style={{ width: "38%" }} />
          <span style={{ width: "24%" }} />
          <span style={{ width: "18%" }} />
        </div>
        <div className="settings-preview-task">
          <span className="settings-preview-check"><Check size={12} aria-hidden /></span>
          <span>
            <strong>{t("Ship the pricing page")}</strong>
            <small><Clock3 size={10} aria-hidden /> {formatHourWithPreference(18, preferences)} · 120m · {t("Focus next")}</small>
          </span>
          <span className="badge accent">95%</span>
        </div>
      </div>
      <p className="field-hint">
        {t(preferences.displayFont === "editorial" ? "Editorial" : preferences.displayFont === "modern" ? "Modern" : "Classic")}
        {" · "}
        {t(preferences.accent === "moss" ? "Moss" : preferences.accent === "ink" ? "Ink" : "Clay")}
        {" · "}
        {t(preferences.density === "compact" ? "Compact" : "Comfortable")}
        {" · "}
        {t(preferences.readingSize === "large" ? "Large text" : "Default text")}
      </p>
    </div>
  );
}

export function LanguageSettings({ settings, timezone, onPatch, onReset }: SectionProps & { timezone: string }) {
  const { t } = useI18n();
  const [zone, setZone] = useState(timezone);
  useEffect(() => setZone(timezone), [timezone]);
  const preferences = normalizePreferences(settings);
  const datePreview = new Intl.DateTimeFormat(preferences.locale, { dateStyle: "medium" }).format(new Date());
  const timePreview = formatHourWithPreference(17, preferences);
  return (
    <section className="settings-section" id="language" aria-labelledby="language-title">
      <SectionHeader
        title={t("Language & region")}
        description="The planner stays local. Language, dates, and the week start with you."
        onReset={() => onReset("language")}
      />
      <div className="settings-card">
        <Row title={t("Language")} description="Preview: the app shell, Today, planning, capture, and Settings are translated. Workspace admin remains English for now.">
          <select className="select" aria-label={t("Language")} value={settings.locale} onChange={(event) => onPatch({ locale: event.target.value as "en" | "zh-TW" })}>
            <option value="en">{t("English")}</option>
            <option value="zh-TW">{t("Traditional Chinese")}</option>
          </select>
        </Row>
        <Row title={t("Time zone")} description="Used for Today, reminders, digests, and recurrence. Commit by leaving the field.">
          <input
            className="input"
            style={{ width: 240 }}
            value={zone}
            onChange={(event) => setZone(event.target.value)}
            onBlur={() => {
              const next = zone.trim();
              if (next && next !== timezone) onPatch({ timezone: next });
            }}
            list="timezones"
            aria-label={t("Time zone")}
          />
          <datalist id="timezones">
            {["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Shanghai", "Asia/Tokyo", "Asia/Taipei", "Australia/Sydney"].map((zoneName) => (
              <option key={zoneName} value={zoneName} />
            ))}
          </datalist>
        </Row>
        <Row title={t("Time format")} description={`Example: ${timePreview}`}>
          <select className="select" aria-label={t("Time format")} value={settings.timeFormat} onChange={(event) => onPatch({ timeFormat: event.target.value as "auto" | "12" | "24" })}>
            <option value="auto">{t("Follow language")}</option>
            <option value="12">{t("12-hour")}</option>
            <option value="24">{t("24-hour")}</option>
          </select>
        </Row>
        <Row title={t("Week starts on")} description="Calendar and weekly rhythms follow this setting.">
          <select className="select" aria-label={t("Week starts on")} value={settings.weekStartsOn} onChange={(event) => onPatch({ weekStartsOn: Number(event.target.value) })}>
            <option value={1}>{t("Monday")}</option>
            <option value={0}>{t("Sunday")}</option>
            <option value={6}>{t("Saturday")}</option>
          </select>
        </Row>
        <Row title={t("Date preview")} description="A local date, formatted with your language.">
          <span className="badge slate">{datePreview}</span>
        </Row>
      </div>
    </section>
  );
}

export function PlanningSettings({ settings, onPatch, onReset }: SectionProps) {
  const { t } = useI18n();
  const preferences = normalizePreferences(settings);
  return (
    <section className="settings-section" id="planning" aria-labelledby="planning-title">
      <SectionHeader
        title={t("Planning")}
        description="Capacity, breathing room, and the edges of the day. Today always explains itself."
        onReset={() => onReset("planning")}
      />
      <div className="settings-card">
        <Row title={t("Daily capacity")} description={`${preferences.capacityMinutes} minutes available to the Today planner.`}>
          <div className="settings-range">
            <input
              type="range"
              min={15}
              max={720}
              step={15}
              value={Math.min(720, preferences.capacityMinutes)}
              aria-label={t("Capacity (minutes)")}
              onChange={(event) => onPatch({ capacityMinutes: Number(event.target.value) })}
            />
            <input
              className="input"
              type="number"
              min={15}
              max={1440}
              value={preferences.capacityMinutes}
              aria-label={t("Capacity (minutes)")}
              onChange={(event) => onPatch({ capacityMinutes: Number(event.target.value) })}
              style={{ width: 72 }}
            />
            <span className="field-hint">min</span>
          </div>
        </Row>
        <Row title={t("Plan buffer")} description="Keep part of the day empty. Smart Plan will leave this breathing room untouched.">
          <div className="settings-range">
            <input
              type="range"
              min={0}
              max={40}
              step={5}
              value={preferences.planBufferPercent}
              aria-label={t("Plan buffer")}
              onChange={(event) => onPatch({ planBufferPercent: Number(event.target.value) })}
            />
            <strong className="settings-range-value">{preferences.planBufferPercent}%</strong>
          </div>
        </Row>
        <Row title={t("Workday")} description="Day Flow shades the hours outside this window. It is a visual cue, not a hard limit.">
          <div className="settings-inline-controls">
            <label className="field">
              <span className="label">{t("Start")}</span>
              <select className="select" aria-label={`${t("Workday")} ${t("Start")}`} value={settings.workdayStart} onChange={(event) => {
                const start = Number(event.target.value);
                onPatch({ workdayStart: start, ...(start >= settings.workdayEnd ? { workdayEnd: Math.min(24, start + 1) } : {}) });
              }}>
                {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{formatHourWithPreference(hour, preferences)}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="label">{t("End")}</span>
              <select className="select" aria-label={`${t("Workday")} ${t("End")}`} value={settings.workdayEnd} onChange={(event) => {
                const end = Number(event.target.value);
                onPatch({ workdayEnd: end, ...(end <= settings.workdayStart ? { workdayStart: Math.max(0, end - 1) } : {}) });
              }}>
                {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => <option key={hour} value={hour}>{formatHourWithPreference(hour % 24, preferences)}</option>)}
              </select>
            </label>
          </div>
        </Row>
        <Row title={t("Buffer between blocks")} description="A little air between the blocks on the rail.">
          <select className="select" aria-label={t("Buffer between blocks")} value={settings.blockBufferMinutes} onChange={(event) => onPatch({ blockBufferMinutes: Number(event.target.value) })}>
            {[0, 5, 10, 15, 20, 30].map((minutes) => <option key={minutes} value={minutes}>{minutes ? `${minutes} min` : "None"}</option>)}
          </select>
        </Row>
        <Row title={t("Default view")} description="Where Drift opens when no board or task link is present.">
          <select className="select" aria-label={t("Default view")} value={settings.startView} onChange={(event) => onPatch({ startView: event.target.value as "today" | "board" | "upcoming" })}>
            <option value="today">{t("Today")}</option>
            <option value="upcoming">{t("Upcoming")}</option>
            <option value="board">{t("Board")}</option>
          </select>
        </Row>
      </div>
    </section>
  );
}

export function FocusCaptureSettings({ settings, onPatch, onReset }: SectionProps) {
  const { t } = useI18n();
  return (
    <section className="settings-section" id="focus" aria-labelledby="focus-title">
      <SectionHeader
        title={t("Focus & capture")}
        description="Defaults for the quiet part of the product. Nothing starts without your gesture."
        onReset={() => onReset("focus")}
      />
      <div className="settings-card">
        <Row title={t("Default focus length")} description="Used when a task has no estimate of its own.">
          <select className="select" aria-label={t("Default focus length")} value={settings.focusMinutes} onChange={(event) => onPatch({ focusMinutes: Number(event.target.value) })}>
            {[15, 25, 45, 60, 90].map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
          </select>
        </Row>
        <Row title={t("Auto-start focus")} description="Begin the timer after the Focus screen opens.">
          <Toggle label={t("Auto-start focus")} checked={settings.focusAutoStart} onChange={(next) => onPatch({ focusAutoStart: next })} />
        </Row>
        <Row title={t("Close capture after adding")} description="Duplicate captures are easier when the dialog stays open.">
          <Toggle label={t("Close capture after adding")} checked={settings.captureCloseAfterAdd} onChange={(next) => onPatch({ captureCloseAfterAdd: next })} />
        </Row>
      </div>
    </section>
  );
}

export function FeaturesSettings({ settings, onPatch, onReset }: SectionProps) {
  const { t } = useI18n();
  const features = parseFeatures(settings.featuresJson);
  const update = (patch: Partial<typeof features>) => onPatch({ featuresJson: serializeFeatures({ ...features, ...patch }) });
  return (
    <section className="settings-section" id="features" aria-labelledby="features-title">
      <SectionHeader
        title={t("Features")}
        description={t("Experimental features are optional and never hide the basic text path.")}
        onReset={() => onReset("features")}
      />
      <div className="settings-card">
        <Row title={t("Day Flow")} description="The 24-hour rail, capacity ring, and focus-next card.">
          <Toggle label={t("Day Flow")} checked={features.dayFlow} onChange={(next) => update({ dayFlow: next })} />
        </Row>
        <Row title={t("Smart Plan")} description="Preview a local rules plan, then apply or undo it. No model call.">
          <Toggle label={t("Smart Plan")} checked={features.smartPlan} onChange={(next) => update({ smartPlan: next })} />
        </Row>
        <Row title={t("Voice capture")} description="Show the browser speech shortcut. Text capture is always available.">
          <Toggle label={t("Voice capture (experimental)")} checked={features.voice} onChange={(next) => update({ voice: next })} />
        </Row>
      </div>
    </section>
  );
}

export function resetSectionPatch(section: ResetSection): SettingsPatch {
  if (section === "appearance") {
    return {
      theme: DEFAULT_PREFERENCES.theme,
      accent: DEFAULT_PREFERENCES.accent,
      displayFont: DEFAULT_PREFERENCES.displayFont,
      readingSize: DEFAULT_PREFERENCES.readingSize,
      density: DEFAULT_PREFERENCES.density,
      motion: DEFAULT_PREFERENCES.motion,
    };
  }
  if (section === "language") {
    return { locale: DEFAULT_PREFERENCES.locale, timeFormat: DEFAULT_PREFERENCES.timeFormat, weekStartsOn: 1 };
  }
  if (section === "planning") {
    return {
      capacityMinutes: DEFAULT_PREFERENCES.capacityMinutes,
      planBufferPercent: DEFAULT_PREFERENCES.planBufferPercent,
      workdayStart: DEFAULT_PREFERENCES.workdayStart,
      workdayEnd: DEFAULT_PREFERENCES.workdayEnd,
      blockBufferMinutes: DEFAULT_PREFERENCES.blockBufferMinutes,
      startView: DEFAULT_PREFERENCES.startView,
    };
  }
  if (section === "focus") {
    return {
      focusMinutes: DEFAULT_PREFERENCES.focusMinutes,
      focusAutoStart: DEFAULT_PREFERENCES.focusAutoStart,
      captureCloseAfterAdd: DEFAULT_PREFERENCES.captureCloseAfterAdd,
    };
  }
  return { featuresJson: JSON.stringify(DEFAULT_PREFERENCES.features) };
}
