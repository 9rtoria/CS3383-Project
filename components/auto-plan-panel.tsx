"use client";

import { CalendarRange, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatDate, parseDateOnly } from "@/lib/format";
import type { AutoPlanPreview } from "@/lib/auto-plan";
import type { AutoPlanMode } from "@/lib/preferences";

function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function AutoPlanPanel({
  preview,
  loading,
  error,
  mode,
  onRefresh,
  onPreview,
  onClear,
}: {
  preview: AutoPlanPreview | null;
  loading: boolean;
  error: string;
  mode: AutoPlanMode;
  onRefresh: () => void;
  onPreview: () => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const current = preview?.options.find((option) => option.id === "balanced") ?? preview?.options[0] ?? null;
  const todayBlocks = current?.blocks.filter((block) => block.date === preview?.startDate) ?? [];
  const over = current?.weeks.some((week) => week.over) ?? false;
  const modeLabel = mode === "suggest" ? t("Suggest only") : mode === "safe" ? t("Safe auto-apply") : mode === "full" ? t("Full auto-apply") : t("Delegated cleanup");
  return (
    <section className="auto-plan-card" aria-labelledby="auto-plan-card-title">
      <div className="auto-plan-card-head">
        <div>
          <div className="eyebrow"><Sparkles size={12} aria-hidden /> {t("Auto-plan")} · {modeLabel}</div>
          <h2 id="auto-plan-card-title">{t("A plan that respects your limits")}</h2>
          <p>{preview ? `${todayBlocks.length} ${t("blocks today")} · ${minutesLabel(current?.scheduledMinutes ?? 0)} ${t("planned")}` : t("Generate a plan from the tasks and limits already in Drift.")}</p>
        </div>
        <div className="auto-plan-card-actions">
          <button type="button" className="btn ghost sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={12} className={loading ? "spin" : undefined} aria-hidden /> {t("Refresh")}
          </button>
          <button type="button" className="btn soft sm" onClick={onPreview} disabled={loading || !preview}>
            <CalendarRange size={12} aria-hidden /> {t("Review plans")}
          </button>
          <button type="button" className="btn ghost sm" onClick={onClear} disabled={loading || !preview}>
            <Trash2 size={12} aria-hidden /> {t("Clear plan")}
          </button>
        </div>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      {current ? (
        <div className="auto-plan-card-foot">
          <span className={`badge ${over ? "amber" : "accent"}`}>{over ? t("Over weekly limit") : t("Within weekly limit")}</span>
          {current.weeks.map((week) => (
            <span key={week.weekStart} className="field-hint">
              {formatDate(parseDateOnly(week.weekStart), { month: "short", day: "numeric" })}: {minutesLabel(week.actualMinutes + week.plannedMinutes)} / {minutesLabel(week.capMinutes)}
            </span>
          ))}
          {current.unscheduled.length ? <span className="field-hint">{current.unscheduled.length} {t("not placed")}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
