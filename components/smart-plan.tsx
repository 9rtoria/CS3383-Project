"use client";

import { ArrowRight, Check, Clock3, Sparkles } from "lucide-react";
import { Modal, PriorityBadge } from "@/components/ui";
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
  if (!tasks.length) return <p className="plan-empty">{empty}</p>;
  return (
    <div className="plan-list">
      {tasks.map((task, index) => (
        <div className="plan-task" key={task.id}>
          <span className="plan-index" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
          <div className="plan-task-copy">
            <strong>{task.title}</strong>
            <span><Clock3 size={10} aria-hidden /> {task.suggestedMinutes || task.estimateMinutes || 30}m · {task.reason}</span>
          </div>
          <PriorityBadge priority={task.priority} compact />
        </div>
      ))}
    </div>
  );
}

export function SmartPlanModal({ open, plan, applying, onClose, onApply }: Props) {
  const over = plan ? plan.minutes > plan.capacity : false;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Smart Plan"
      eyebrow={<><Sparkles size={12} aria-hidden /> Preview first · local rules only</>}
      width={820}
      footer={
        <>
          <span className="field-hint" style={{ marginRight: "auto" }}>Nothing changes until you apply.</span>
          <button type="button" className="btn ghost" onClick={onClose} disabled={applying}>Cancel</button>
          <button type="button" className="btn primary" onClick={onApply} disabled={applying || !plan?.after.length}>
            <Check size={13} aria-hidden /> {applying ? "Applying…" : "Apply this plan"}
          </button>
        </>
      }
    >
      {plan ? (
        <>
          <div className="plan-summary">
            <div>
              <span className="eyebrow">Proposed day</span>
              <strong>{minutesLabel(plan.minutes)} <small>of {minutesLabel(plan.capacity)}</small></strong>
            </div>
            <div className="plan-summary-stats">
              <span><strong>{plan.after.length}</strong> blocks</span>
              <span><strong>{plan.remaining >= 0 ? minutesLabel(plan.remaining) : `+${minutesLabel(Math.abs(plan.remaining))}`}</strong> {over ? "over capacity" : "left"}</span>
              <span><strong>{plan.added.length}</strong> added</span>
              <span><strong>{plan.dropped.length}</strong> waiting</span>
            </div>
          </div>

          <div className="plan-grid">
            <div className="plan-column">
              <div className="plan-column-head"><span className="eyebrow">Before</span><span>{plan.before.length} chosen</span></div>
              <PlanList tasks={plan.before} empty="No tasks were chosen yet. This plan starts from the ranked suggestions." />
            </div>
            <div className="plan-column after">
              <div className="plan-column-head"><span className="eyebrow">After</span><span>fits your capacity</span></div>
              <PlanList tasks={plan.after} empty="Nothing fits yet. Add an estimate or free up capacity first." />
            </div>
          </div>

          <div className="plan-changes">
            {plan.added.length ? <span className="badge accent"><ArrowRight size={10} /> {plan.added.length} added</span> : null}
            {plan.dropped.length ? <span className="badge amber">{plan.dropped.length} left out of this plan</span> : null}
            <span className="field-hint">Priority, due date, estimate, and dependencies are weighted locally. No model call.</span>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
