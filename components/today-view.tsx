"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Check, ChevronRight, Clock3, Coffee, Link2, Play, RefreshCw, Sparkles, SunMedium, X } from "lucide-react";
import { EmptyState, PriorityBadge, Spinner } from "@/components/ui";
import { DayFlow } from "@/components/day-flow";
import { SmartPlanModal, type SmartPlanPreview } from "@/components/smart-plan";
import { useToast } from "@/components/toast";
import { api, formatApiError } from "@/lib/client";
import { formatDue, memberName } from "@/lib/format";
import { playSound } from "@/lib/sound";
import type { Task, TodayPayload, Workspace } from "@/lib/types";

type Props = {
  workspace: Workspace;
  refreshKey: number;
  userName: string;
  onOpenTask: (taskId: string) => void;
  onFocusTask: (task: Task) => void;
  onQuickCapture: () => void;
  onNavigate: (view: "upcoming" | "calendar" | "board") => void;
  onChanged: () => void;
};

type Suggestion = TodayPayload["suggestions"][number];

const EMPTY_CAPACITY: TodayPayload["capacity"] = {
  totalMinutes: 0,
  selectedMinutes: 0,
  remainingMinutes: 0,
  percent: 0,
  overbooked: false,
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function planScore(task: Suggestion): number {
  // Accepted tasks get a bonus in the normal ranking. A fresh plan should
  // re-earn its place, so remove that bonus before comparing candidates.
  return task.score - (task.accepted ? 55 : 0);
}

function buildPlan(data: TodayPayload): SmartPlanPreview {
  const before = data.suggestions.filter((task) => task.accepted);
  const candidates = data.suggestions
    .filter((task) => !task.blocked)
    .sort((a, b) => planScore(b) - planScore(a) || a.suggestedMinutes - b.suggestedMinutes);
  let remaining = Math.max(0, data.capacity.totalMinutes);
  const after: Suggestion[] = [];
  for (const task of candidates) {
    const minutes = task.suggestedMinutes || task.estimateMinutes || 30;
    if (minutes <= remaining) {
      after.push(task);
      remaining -= minutes;
    }
  }
  const afterIds = new Set(after.map((task) => task.id));
  return {
    before,
    after,
    added: after.filter((task) => !task.accepted),
    dropped: before.filter((task) => !afterIds.has(task.id)),
    minutes: after.reduce((sum, task) => sum + (task.suggestedMinutes || task.estimateMinutes || 30), 0),
    remaining,
    capacity: data.capacity.totalMinutes,
  };
}

export function TodayView({ workspace, refreshKey, userName, onOpenTask, onFocusTask, onQuickCapture, onNavigate, onChanged }: Props) {
  const toast = useToast();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [plan, setPlan] = useState<SmartPlanPreview | null>(null);
  const [applyingPlan, setApplyingPlan] = useState(false);
  const [rebalanceNote, setRebalanceNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const payload = await api<TodayPayload>(`/api/today?workspaceId=${encodeURIComponent(workspace.id)}`, { workspaceId: workspace.id });
      setData(payload);
    } catch (loadError) {
      setError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, refreshKey]);

  const visible = useMemo(() => {
    if (!data) return [];
    const accepted = data.suggestions.filter((task) => task.accepted || task.selected);
    const rest = data.suggestions.filter((task) => !task.accepted && !task.selected);
    return showAll ? [...accepted, ...rest] : [...accepted, ...rest].slice(0, 8);
  }, [data, showAll]);

  async function act(action: "accept" | "dismiss" | "rebalance", taskId?: string) {
    if (!data) return;
    const beforeSelected = new Set(data.suggestions.filter((task) => task.accepted || task.selected).map((task) => task.id));
    setBusy(taskId ?? action);
    try {
      const payload = await api<TodayPayload>("/api/today", {
        method: "POST",
        workspaceId: workspace.id,
        body: { action, workspaceId: workspace.id, ...(taskId ? { taskId } : {}) },
      });
      setData(payload);
      onChanged();
      setRebalanceNote(null);
      if (action === "accept") {
        playSound("tap");
        toast.success("Chosen for today.");
      } else if (action === "dismiss") {
        playSound("move");
        toast.success("Moved to Later for today.");
      } else {
        const afterSelected = new Set(payload.suggestions.filter((task) => task.accepted || task.selected).map((task) => task.id));
        const moved = [...beforeSelected].filter((id) => !afterSelected.has(id));
        setRebalanceNote(
          moved.length
            ? `${moved.length} block${moved.length === 1 ? "" : "s"} left out of today's plan. The rail now fits your capacity.`
            : "Already balanced. The rail kept its shape.",
        );
        playSound("move");
        toast.success("Today rebalanced around your capacity.");
      }
    } catch (actionError) {
      playSound("error");
      toast.error(formatApiError(actionError));
    } finally {
      setBusy(null);
    }
  }

  function openSmartPlan() {
    if (!data) return;
    setPlan(buildPlan(data));
    setPlanOpen(true);
    playSound("tap");
  }

  async function applySmartPlan() {
    if (!data || !plan || applyingPlan) return;
    const beforeIds = data.suggestions.filter((task) => task.accepted).map((task) => task.id);
    const taskIds = plan.after.map((task) => task.id);
    setApplyingPlan(true);
    try {
      const payload = await api<TodayPayload>("/api/today", {
        method: "POST",
        workspaceId: workspace.id,
        body: { action: "applyPlan", workspaceId: workspace.id, taskIds },
      });
      setData(payload);
      setPlanOpen(false);
      setPlan(null);
      onChanged();
      playSound("complete");
      toast.push({
        message: `Smart Plan applied · ${plan.minutes}m planned.`,
        tone: "success",
        actionLabel: "Undo",
        onAction: async () => {
          try {
            const restored = await api<TodayPayload>("/api/today", {
              method: "POST",
              workspaceId: workspace.id,
              body: { action: "applyPlan", workspaceId: workspace.id, taskIds: beforeIds },
            });
            setData(restored);
            onChanged();
            playSound("move");
            toast.success("Previous plan restored.");
          } catch (undoError) {
            playSound("error");
            toast.error(formatApiError(undoError));
          }
        },
      });
    } catch (planError) {
      playSound("error");
      toast.error(formatApiError(planError));
    } finally {
      setApplyingPlan(false);
    }
  }

  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const capacityPercent = data ? Math.min(100, Math.round((data.capacity.selectedMinutes / Math.max(1, data.capacity.totalMinutes)) * 100)) : 0;
  const over = data?.capacity.overbooked ?? false;
  const acceptedCount = data?.suggestions.filter((task) => task.accepted).length ?? 0;

  if (loading && !data) {
    return (
      <div aria-busy="true" aria-label="Loading today">
        <div className="skeleton" style={{ height: 230, borderRadius: 18, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 160, borderRadius: 12 }} />
      </div>
    );
  }

  return (
    <>
      <section className="today-hero">
        <div>
          <div className="hero-kicker"><SunMedium size={13} aria-hidden /> {todayLabel}</div>
          <h1 className="hero-title">{greeting()}, {userName.split(" ")[0]}.</h1>
          <p className="hero-copy">
            {acceptedCount
              ? `${acceptedCount} task${acceptedCount === 1 ? "" : "s"} chosen for today. Start with the first one; the rest can wait.`
              : "Your day is open. Pick one meaningful thing, or capture whatever is on your mind."}
          </p>
          <div className="inline">
            <button type="button" className="btn primary lg" onClick={onQuickCapture}>
              <Sparkles size={15} aria-hidden /> Capture a task
            </button>
            <button type="button" className="btn lg" onClick={() => onNavigate("calendar")}>
              <CalendarDays size={15} aria-hidden /> See the month
            </button>
          </div>
        </div>
        <div className="capacity-panel" aria-label="Daily capacity">
          <div className="capacity-top">
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Today&apos;s capacity</div>
              <div className="capacity-number">
                {data?.capacity.selectedMinutes ?? 0}
                <small>of {data?.capacity.totalMinutes ?? 0} min</small>
              </div>
            </div>
            <span className={`badge ${over ? "amber" : "accent"}`}>{over ? "Overbooked" : capacityPercent >= 85 ? "Nearly full" : "Comfortable"}</span>
          </div>
          <div className="progress" aria-hidden><span style={{ width: `${capacityPercent}%`, background: over ? "var(--warning)" : undefined }} /></div>
          <div className="capacity-legend">
            <span>{data?.counts.selected ?? 0} suggested</span>
            <span>{Math.max(0, (data?.capacity.totalMinutes ?? 0) - (data?.capacity.selectedMinutes ?? 0))} min left</span>
          </div>
          <div className="capacity-actions">
            <button type="button" className="btn soft sm" onClick={openSmartPlan} disabled={!data?.suggestions.length}>
              <Sparkles size={12} aria-hidden /> Smart Plan
            </button>
            <button type="button" className="btn ghost sm" onClick={() => void act("rebalance")} disabled={busy === "rebalance"}>
              <RefreshCw size={12} className={busy === "rebalance" ? "spin" : undefined} aria-hidden /> Rebalance
            </button>
          </div>
        </div>
      </section>

      {error ? <EmptyState icon={<Coffee size={20} />} title="Today didn’t load" description={error} action={<button type="button" className="btn primary" onClick={() => void load()}>Try again</button>} /> : null}

      <DayFlow
        tasks={data?.suggestions ?? []}
        capacity={data?.capacity ?? EMPTY_CAPACITY}
        busy={busy}
        note={rebalanceNote}
        onOpenTask={onOpenTask}
        onFocusTask={onFocusTask}
        onDismiss={(taskId) => void act("dismiss", taskId)}
        onRebalance={() => void act("rebalance")}
      />

      <div className="today-grid">
        <div>
          <div className="section-head">
            <div>
              <h2 className="section-title">A short list, not a backlog</h2>
              <p className="section-subtitle">Ordered by what needs you first. Keep it honest.</p>
            </div>
          </div>
          <div className="today-list">
            {visible.map((task, index) => (
              <article key={task.id} className={`focus-card${task.accepted ? " accepted" : ""}${task.blocked ? " blocked" : ""}`}>
                <div className="focus-index" aria-hidden>{task.accepted ? <Check size={14} /> : String(index + 1).padStart(2, "0")}</div>
                <div className="focus-main">
                  <button type="button" className="focus-title" onClick={() => onOpenTask(task.id)}>{task.title}</button>
                  <div className="focus-reason"><Sparkles size={11} aria-hidden /> {task.reason}</div>
                  <div className="focus-meta">
                    {task.accepted ? <span className="badge accent">Chosen today</span> : null}
                    <PriorityBadge priority={task.priority} compact />
                    {task.dueDate ? <span><CalendarDays size={10} aria-hidden /> {formatDue(task.dueDate, task.dueAllDay)}</span> : null}
                    {task.estimateMinutes ? <span><Clock3 size={10} aria-hidden /> {task.estimateMinutes}m</span> : null}
                    {task.actualMinutes ? <span className="focus-actual"><Clock3 size={10} aria-hidden /> {task.actualMinutes}m tracked</span> : null}
                    {task.labels.slice(0, 2).map((label) => <span className={`badge ${label.color}`} key={label.id}>{label.name}</span>)}
                    {task.board ? <span style={{ color: "var(--faint)" }}>{task.board.name}</span> : null}
                    {task.assignee ? <span>· {memberName(task.assignee)}</span> : null}
                    {task.openDependencies ? <span className="task-foot-meta blocked"><Link2 size={10} /> waiting</span> : null}
                  </div>
                </div>
                <div className="focus-actions">
                  {!task.accepted && !task.blocked ? (
                    <button type="button" className="btn soft sm" onClick={() => void act("accept", task.id)} disabled={busy === task.id} aria-label={`Choose ${task.title} for today`}>
                      {busy === task.id ? <Spinner label="" /> : <Check size={13} aria-hidden />} Choose
                    </button>
                  ) : null}
                  {!task.blocked ? (
                    <button type="button" className="icon-btn sm" aria-label={`Start focus on ${task.title}`} title="Start focus" onClick={() => onFocusTask(task)}>
                      <Play size={13} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={task.accepted ? `Move ${task.title} to Later` : `Dismiss ${task.title} for today`}
                    title={task.accepted ? "Move to Later" : "Not today"}
                    onClick={() => void act("dismiss", task.id)}
                    disabled={busy === task.id}
                  >
                    {task.accepted ? <Clock3 size={14} /> : <X size={14} />}
                  </button>
                  <button type="button" className="icon-btn sm" aria-label={`Open ${task.title}`} onClick={() => onOpenTask(task.id)}><ChevronRight size={15} /></button>
                </div>
              </article>
            ))}
            {visible.length === 0 ? (
              <EmptyState
                icon={<Coffee size={20} />}
                title="A clear day."
                description="Nothing is urgent. Capture one small next step, or take the win and stop here."
                action={<button type="button" className="btn primary" onClick={onQuickCapture}><Sparkles size={14} /> Add something small</button>}
              />
            ) : null}
          </div>
          {data && data.suggestions.length > 8 ? (
            <button type="button" className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show less" : `Show the other ${data.suggestions.length - 8}`} <ChevronRight size={13} style={{ transform: showAll ? "rotate(-90deg)" : "rotate(90deg)" }} />
            </button>
          ) : null}
        </div>

        <aside className="today-side">
          <div className="card side-card">
            <div className="section-head" style={{ marginBottom: 10 }}>
              <h2 className="section-title">At a glance</h2>
              <button type="button" className="btn ghost sm" onClick={() => onNavigate("upcoming")}>Next 14 days <ArrowRight size={12} /></button>
            </div>
            <ul className="side-list">
              <li><span className="side-dot over" /> Overdue <strong>{data?.counts.overdue ?? 0}</strong></li>
              <li><span className="side-dot today" /> Chosen today <strong>{acceptedCount}</strong></li>
              <li><span className="side-dot week" /> Open in {workspace.name} <strong>{data?.counts.open ?? 0}</strong></li>
            </ul>
          </div>

          <div className="card side-card">
            <div className="section-head" style={{ marginBottom: 8 }}>
              <h2 className="section-title">A note on pace</h2>
            </div>
            <p className="section-subtitle" style={{ lineHeight: 1.65, margin: 0 }}>
              {over
                ? "Today asks for more minutes than you have. Drag a block to the Later shelf, or let Rebalance protect the important work."
                : "The list is a suggestion, not a debt. If only the first task happens, that still counts."}
            </p>
          </div>

          <div className="card quote-card">
            <p>“Slow is smooth. Smooth is fast.”</p>
            <span>Make the next step obvious, then take it.</span>
          </div>
        </aside>
      </div>

      <div className="inline" style={{ marginTop: 24 }}>
        <button type="button" className="btn ghost" onClick={() => onNavigate("board")}>Open the full board <ArrowRight size={13} /></button>
        <span className="field-hint">Suggestions use local rules only — no model call.</span>
      </div>

      <SmartPlanModal
        open={planOpen}
        plan={plan}
        applying={applyingPlan}
        onClose={() => { if (!applyingPlan) { setPlanOpen(false); setPlan(null); } }}
        onApply={() => void applySmartPlan()}
      />
    </>
  );
}
