"use client";

import { ArrowRight, Check, Clock3, Sparkles } from "lucide-react";
import { Modal, PriorityBadge } from "@/components/ui";
import { translateReason, useI18n } from "@/lib/i18n";
import type { TodayPayload } from "@/lib/types";

type Suggestion = TodayPayload["suggestions"][number];

export type SmartPlanPreview = {
  before: Suggestion[];
  after: Suggestion[];
  added: Suggestion[];
  dropped: Suggestion[];
  minutes: number;
  remaining: number;
  capacity: number;
  totalCapacity: number;
  bufferMinutes: number;
};

type Props = {
  open: boolean;
  plan: SmartPlanPreview | null;
  applying: boolean;
  onClose: () => void;
  onApply: () => void;
};

function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function PlanList({ tasks, empty }: { tasks: Suggestion[]; empty: string }) {
  const { t } = useI18n();
  if (!tasks.length) return <p className="plan-empty">{empty}</p>;
  return (
    <div className="plan-list">
      {tasks.map((task, index) => (
        <div className="plan-task" key={task.id}>
          <span className="plan-index" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
          <div className="plan-task-copy">
            <strong>{task.title}</strong>
            <span><Clock3 size={10} aria-hidden /> {task.suggestedMinutes || task.estimateMinutes || 30}m · {translateReason(task.reason, t)}</span>
          </div>
          <PriorityBadge priority={task.priority} compact />
        </div>
      ))}
    </div>
  );
}

export function SmartPlanModal({ open, plan, applying, onClose, onApply }: Props) {
  const { t } = useI18n();
  const over = plan ? plan.minutes > plan.capacity : false;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Smart Plan")}
      eyebrow={<><Sparkles size={12} aria-hidden /> {t("Preview first · local rules only")}</>}
      width={820}
      footer={
        <>
          <span className="field-hint" style={{ marginRight: "auto" }}>{t("Nothing changes until you apply.")}</span>
          <button type="button" className="btn ghost" onClick={onClose} disabled={applying}>{t("Cancel")}</button>
          <button type="button" className="btn primary" onClick={onApply} disabled={applying || !plan?.after.length}>
            <Check size={13} aria-hidden /> {applying ? t("Applying…") : t("Apply this plan")}
          </button>
        </>
      }
    >
      {plan ? (
        <>
          <div className="plan-summary">
            <div>
              <span className="eyebrow">{t("Proposed day")}</span>
              <strong>{minutesLabel(plan.minutes)} <small>{t("of")} {minutesLabel(plan.capacity)}</small></strong>
            </div>
            <div className="plan-summary-stats">
              <span><strong>{plan.after.length}</strong> {t("blocks")}</span>
              <span><strong>{plan.remaining >= 0 ? minutesLabel(plan.remaining) : `+${minutesLabel(Math.abs(plan.remaining))}`}</strong> {over ? t("over capacity") : t("left")}</span>
              <span><strong>{plan.added.length}</strong> {t("added")}</span>
              <span><strong>{plan.dropped.length}</strong> {t("waiting")}</span>
              {plan.bufferMinutes > 0 ? <span><strong>{minutesLabel(plan.bufferMinutes)}</strong> {t("buffer")}</span> : null}
            </div>
          </div>

          <div className="plan-grid">
            <div className="plan-column">
              <div className="plan-column-head"><span className="eyebrow">{t("Before")}</span><span>{plan.before.length} {t("chosen")}</span></div>
              <PlanList tasks={plan.before} empty={t("No tasks were chosen yet. This plan starts from the ranked suggestions.")} />
            </div>
            <div className="plan-column after">
              <div className="plan-column-head"><span className="eyebrow">{t("After")}</span><span>{t("fits your capacity")}</span></div>
              <PlanList tasks={plan.after} empty={t("Nothing fits yet. Add an estimate or free up capacity first.")} />
            </div>
          </div>

          <div className="plan-changes">
            {plan.added.length ? <span className="badge accent"><ArrowRight size={10} /> {plan.added.length} {t("added")}</span> : null}
            {plan.dropped.length ? <span className="badge amber">{plan.dropped.length} {t("left out of this plan")}</span> : null}
            {plan.bufferMinutes > 0 ? <span className="badge moss">{minutesLabel(plan.bufferMinutes)} {t("breathing room")}</span> : null}
            <span className="field-hint">{t("Priority, due date, estimate, and dependencies are weighted locally. No model call.")}</span>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
