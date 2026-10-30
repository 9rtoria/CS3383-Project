"use client";

import { useState } from "react";
import { CalendarDays, Check, Clock3, Sparkles } from "lucide-react";
import { Modal, PriorityBadge } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatTime, parseDateOnly } from "@/lib/format";
import type { AutoPlanOption, AutoPlanOptionId, AutoPlanPreview } from "@/lib/auto-plan";

function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function blockTime(startMinute: number, duration: number): string {
  const start = new Date(2000, 0, 1, Math.floor(startMinute / 60), startMinute % 60);
  const end = new Date(2000, 0, 1, Math.floor((startMinute + duration) / 60), (startMinute + duration) % 60);
  return `${formatTime(start)}–${formatTime(end)}`;
}

function optionName(id: AutoPlanOptionId, t: (key: string) => string): string {
  if (id === "focus") return t("Focus first");
  if (id === "light") return t("Light day");
  return t("Balanced");
}

function optionSummary(id: AutoPlanOptionId): string {
  if (id === "focus") return "Protect the hardest work early and let the rest follow.";
  if (id === "light") return "Only the work that truly needs to happen now.";
  return "A realistic spread with space between blocks.";
}

function OptionCard({ option, active, onClick }: { option: AutoPlanOption; active: boolean; onClick: () => void }) {
  const { t } = useI18n();
  const over = option.weeks.find((week) => week.over);
  return (
    <button type="button" className={`auto-plan-option${active ? " active" : ""}`} aria-pressed={active} onClick={onClick}>
      <span className="auto-plan-option-head">
        <strong>{optionName(option.id, t)}</strong>
        {active ? <Check size={13} aria-hidden /> : null}
      </span>
      <span className="auto-plan-option-summary">{t(optionSummary(option.id))}</span>
      <span className="auto-plan-option-stats">
        <span>{option.blocks.length} {t("blocks")}</span>
        <span>{minutesLabel(option.scheduledMinutes)}</span>
        {over ? <span className="badge amber">{t("over limit")}</span> : null}
      </span>
    </button>
  );
}

function OptionDetail({ option }: { option: AutoPlanOption }) {
  const { t } = useI18n();
  const byDate = new Map<string, typeof option.blocks>();
  for (const block of option.blocks) {
    const list = byDate.get(block.date) ?? [];
    list.push(block);
    byDate.set(block.date, list);
  }
  const sortedDays = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right));
  return (
    <div className="auto-plan-detail">
      <div className="auto-plan-day-list">
        {sortedDays.map(([date, blocks]) => (
          <section key={date} className="auto-plan-day">
            <h4>{formatDate(parseDateOnly(date), { weekday: "long", month: "short", day: "numeric" })}</h4>
            {[...blocks].sort((left, right) => left.startMinute - right.startMinute).map((block) => (
              <div className="auto-plan-block-row" key={`${block.taskId}-${date}-${block.startMinute}`}>
                <span className="auto-plan-block-time"><Clock3 size={10} aria-hidden /> {blockTime(block.startMinute, block.minutes)}</span>
                <span className="auto-plan-block-title">{block.title ?? block.taskId}</span>
                {block.priority ? <PriorityBadge priority={block.priority} compact /> : null}
                <span className="field-hint">{block.minutes}m</span>
              </div>
            ))}
          </section>
        ))}
        {!byDate.size ? <p className="plan-empty">{t("Nothing fits in this plan yet.")}</p> : null}
      </div>
      <div className="auto-plan-side">
        <div className="auto-plan-side-block">
          <span className="eyebrow">{t("Weekly load")}</span>
          {option.weeks.map((week) => (
            <div className="auto-plan-week" key={week.weekStart}>
              <span>{formatDate(parseDateOnly(week.weekStart), { month: "short", day: "numeric" })}</span>
              <strong className={week.over ? "field-error" : undefined}>{minutesLabel(week.actualMinutes + week.plannedMinutes)} / {minutesLabel(week.capMinutes)}</strong>
            </div>
          ))}
        </div>
        {option.unscheduled.length ? (
          <div className="auto-plan-side-block">
            <span className="eyebrow">{t("Not placed")}</span>
            {option.unscheduled.slice(0, 8).map((task) => (
              <div className="auto-plan-unscheduled" key={task.taskId}>
                <strong>{task.title}</strong>
                <span>{task.reason}</span>
              </div>
            ))}
          </div>
        ) : null}
        {option.warnings.length ? (
          <div className="auto-plan-side-block">
            <span className="eyebrow">{t("Warnings")}</span>
            {option.warnings.map((warning) => <p className="field-hint" key={warning}>{warning}</p>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AutoPlanModal({
  open,
  preview,
  applying,
  onClose,
  onApply,
}: {
  open: boolean;
  preview: AutoPlanPreview | null;
  applying: boolean;
  onClose: () => void;
  onApply: (id: AutoPlanOptionId) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<AutoPlanOptionId>("balanced");
  const option = preview?.options.find((entry) => entry.id === selected) ?? preview?.options[0] ?? null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Auto-plan")}
      eyebrow={<><Sparkles size={12} aria-hidden /> {t("Local scheduling · no model call")}</>}
      width={980}
      footer={
        <>
          <span className="field-hint" style={{ marginRight: "auto" }}>{t("Nothing changes until you apply. Undo stays available for five minutes.")}</span>
          <button type="button" className="btn ghost" onClick={onClose} disabled={applying}>{t("Cancel")}</button>
          <button type="button" className="btn primary" onClick={() => option && onApply(option.id)} disabled={applying || !option?.blocks.length}>
            <Check size={13} aria-hidden /> {applying ? t("Applying…") : t("Apply this plan")}
          </button>
        </>
      }
    >
      {preview ? (
        <>
          <div className="auto-plan-options">
            {preview.options.map((entry) => (
              <OptionCard key={entry.id} option={entry} active={entry.id === selected} onClick={() => setSelected(entry.id)} />
            ))}
          </div>
          {option ? <OptionDetail option={option} /> : null}
          <p className="field-hint" style={{ marginTop: 12 }}>
            <CalendarDays size={11} aria-hidden /> {t("Due dates and completed work are never changed. Only flexible plan blocks move.")}
          </p>
        </>
      ) : <p className="section-subtitle">{t("No plan is available yet.")}</p>}
    </Modal>
  );
}
