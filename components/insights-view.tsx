"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarRange, Clock3, Plus, Timer, UsersRound } from "lucide-react";
import { EmptyState, PriorityBadge, Spinner } from "@/components/ui";
import { api, formatApiError } from "@/lib/client";
import { addDaysToDateString, dateStringInTimeZone } from "@/lib/time";
import { formatDate, parseDateOnly, percent } from "@/lib/format";
import type { InsightTask, InsightsPayload, Workspace } from "@/lib/types";

type Props = {
  workspace: Workspace;
  refreshKey: number;
  timeZone: string;
  onOpenTask: (taskId: string) => void;
  onQuickCapture: () => void;
};

type Tab = "timeline" | "workload";

export function InsightsView({ workspace, refreshKey, timeZone, onOpenTask, onQuickCapture }: Props) {
  const [tab, setTab] = useState<Tab>("timeline");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<InsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api<InsightsPayload>(
        `/api/insights?days=${days}&workspaceId=${encodeURIComponent(workspace.id)}`,
        { workspaceId: workspace.id },
      );
      setData(payload);
      setError("");
    } catch (loadError) {
      setError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }, [days, workspace.id]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><BarChart3 size={12} /> Planning depth, on demand</div>
          <h1 className="page-title">Insights</h1>
          <p className="page-subtitle">A longer horizon and a kinder read on load. No scores, no guilt.</p>
        </div>
        <div className="page-actions">
          <div className="segmented" role="group" aria-label="Insights view">
            <button type="button" className={tab === "timeline" ? "active" : ""} aria-pressed={tab === "timeline"} onClick={() => setTab("timeline")}><CalendarRange size={13} aria-hidden /> Timeline</button>
            <button type="button" className={tab === "workload" ? "active" : ""} aria-pressed={tab === "workload"} onClick={() => setTab("workload")}><UsersRound size={13} aria-hidden /> Workload</button>
          </div>
          <button type="button" className="btn primary" onClick={onQuickCapture}><Plus size={14} aria-hidden /> New task</button>
        </div>
      </div>

      {loading && !data ? <Spinner label="Loading insights" /> : error ? (
        <EmptyState icon={<BarChart3 size={20} />} title="Insights didn’t load" description={error} action={<button type="button" className="btn primary" onClick={() => void load()}>Try again</button>} />
      ) : !data ? null : tab === "timeline" ? (
        <TimelinePanel data={data} timeZone={timeZone} days={days} onDays={setDays} onOpenTask={onOpenTask} />
      ) : (
        <WorkloadPanel data={data} onOpenTask={onOpenTask} />
      )}
    </>
  );
}

function TimelinePanel({ data, timeZone, days, onDays, onOpenTask }: {
  data: InsightsPayload;
  timeZone: string;
  days: number;
  onDays: (days: number) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const dates = useMemo(() => Array.from({ length: days }, (_, index) => addDaysToDateString(data.today, index)), [data.today, days]);
  const scheduled = useMemo(() => data.tasks.filter((task) => !task.completedAt && (task.startDate || task.dueDate)), [data.tasks]);
  const unscheduled = useMemo(() => data.tasks.filter((task) => !task.completedAt && !task.startDate && !task.dueDate), [data.tasks]);
  const grouped = useMemo(() => {
    const map = new Map<string, InsightTask[]>();
    for (const task of scheduled) {
      const list = map.get(task.boardId) ?? [];
      list.push(task);
      map.set(task.boardId, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [scheduled]);

  return (
    <>
      <div className="insight-toolbar">
        <span className="field-hint">{scheduled.length} dated task{scheduled.length === 1 ? "" : "s"} · {unscheduled.length} unscheduled · dates in {timeZone}</span>
        <div className="segmented" role="group" aria-label="Timeline range">
          {[14, 30, 60].map((value) => <button key={value} type="button" className={days === value ? "active" : ""} aria-pressed={days === value} onClick={() => onDays(value)}>{value} days</button>)}
        </div>
      </div>

      {!scheduled.length ? (
        <EmptyState icon={<CalendarRange size={20} />} title="No dated work in this window" description="Timeline uses start and due dates. Add a date in a task, or keep working from Today — that is a valid way to plan." />
      ) : (
        <div className="timeline-scroll" role="region" aria-label="Task timeline" tabIndex={0}>
          <div className="timeline" style={{ "--timeline-days": days } as React.CSSProperties}>
            <div className="timeline-header">
              <div className="timeline-label">Task</div>
              <div className="timeline-dates" aria-hidden>
                {dates.map((date, index) => (
                  <span key={date} className={index === 0 ? "today" : ""}>
                    <strong>{index === 0 ? "Today" : parseDateOnly(date).toLocaleDateString(undefined, { weekday: "short" })}</strong>
                    <small>{parseDateOnly(date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small>
                  </span>
                ))}
              </div>
            </div>
            {grouped.map(([boardId, tasks]) => (
              <div key={boardId} className="timeline-group">
                <div className="timeline-group-label">{tasks[0]?.boardName ?? "Board"} <span>{tasks.length}</span></div>
                {tasks.map((task) => {
                  const startKey = task.startDate ? dateStringInTimeZone(new Date(task.startDate), timeZone) : dateStringInTimeZone(new Date(task.dueDate!), timeZone);
                  const dueKey = task.dueDate ? dateStringInTimeZone(new Date(task.dueDate), timeZone) : startKey;
                  const startIndex = Math.max(0, dates.indexOf(startKey));
                  const rawEnd = dates.indexOf(dueKey);
                  const endIndex = rawEnd < 0 ? days - 1 : Math.min(days - 1, rawEnd);
                  const width = Math.max(1, endIndex - startIndex + 1);
                  return (
                    <div className="timeline-row" key={task.id}>
                      <button type="button" className="timeline-task" onClick={() => onOpenTask(task.id)}>
                        <span className="timeline-task-title">{task.title}</span>
                        <span className="timeline-task-meta">
                          <PriorityBadge priority={task.priority} compact />
                          {task.estimateMinutes ? <span><Clock3 size={10} aria-hidden /> {task.estimateMinutes}m</span> : null}
                          {task.assignee ? <span>{task.assignee.name}</span> : null}
                        </span>
                      </button>
                      <div className="timeline-track" aria-hidden>
                        <span
                          className={`timeline-bar${task.isDone ? " done" : ""}${task.priority === "urgent" || task.priority === "high" ? " urgent" : ""}`}
                          style={{ gridColumn: `${startIndex + 1} / span ${width}` }}
                          title={`${task.title}: ${formatDate(task.startDate ?? task.dueDate, { month: "short", day: "numeric" })} – ${formatDate(task.dueDate ?? task.startDate, { month: "short", day: "numeric" })}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {unscheduled.length ? (
        <section className="card card-pad" style={{ marginTop: 18 }} aria-labelledby="unscheduled-title">
          <div className="section-head" style={{ marginBottom: 8 }}>
            <h2 className="section-title" id="unscheduled-title">Unscheduled</h2>
            <span className="badge slate">{unscheduled.length}</span>
          </div>
          <p className="field-hint" style={{ marginTop: 0 }}>Undated work is not late. It waits until you give it a place.</p>
          <div className="unscheduled-list">
            {unscheduled.slice(0, 20).map((task) => (
              <button type="button" className="slim-task" key={task.id} onClick={() => onOpenTask(task.id)}>
                <span className="slim-title">{task.title}</span>
                <span className="task-foot-meta">{task.boardName} · {task.columnName}</span>
              </button>
            ))}
          </div>
          {unscheduled.length > 20 ? <p className="field-hint">Showing 20 of {unscheduled.length}. Search can find the rest.</p> : null}
        </section>
      ) : null}
    </>
  );
}

function WorkloadPanel({ data, onOpenTask }: { data: InsightsPayload; onOpenTask: (taskId: string) => void }) {
  const maxEstimate = Math.max(1, ...data.members.map((member) => member.estimateMinutes));
  const maxBoard = Math.max(1, ...data.boards.map((board) => board.estimateMinutes));
  const focus = [...data.tasks]
    .filter((task) => !task.completedAt)
    .sort((a, b) => {
      const rank = (priority: string) => priority === "urgent" ? 0 : priority === "high" ? 1 : priority === "medium" ? 2 : 3;
      return rank(a.priority) - rank(b.priority) || String(a.dueDate ?? "9999").localeCompare(String(b.dueDate ?? "9999"));
    })
    .slice(0, 8);

  return (
    <>
      <div className="metric-grid">
        <Metric label="Open tasks" value={data.totals.open} note={`${data.totals.taskCount} total in view`} />
        <Metric label="Due this week" value={data.totals.dueThisWeek} note="Next 7 days" tone={data.totals.dueThisWeek > 0 ? "amber" : undefined} />
        <Metric label="Overdue" value={data.totals.overdue} note="Needs a decision, not guilt" tone={data.totals.overdue > 0 ? "rose" : undefined} />
        <Metric label="Completed · 7 days" value={data.totals.completedLast7} note="Momentum you can see" tone="moss" />
        <Metric label="Estimated effort" value={`${Math.round(data.totals.estimateMinutes / 60 * 10) / 10}h`} note={data.totals.unestimated ? `${data.totals.unestimated} tasks unestimated` : "All open work estimated"} />
      </div>

      <div className="insight-grid">
        <section className="card card-pad" aria-labelledby="workload-people-title">
          <div className="section-head">
            <div>
              <h2 className="section-title" id="workload-people-title">Load by person</h2>
              <p className="section-subtitle">Estimate of open work, not a performance score.</p>
            </div>
            <Timer size={17} aria-hidden style={{ color: "var(--faint)" }} />
          </div>
          <div className="workload-list">
            {data.members.map((member) => (
              <div className="workload-row" key={member.id ?? "unassigned"}>
                <div className="workload-copy">
                  <strong>{member.name}</strong>
                  <span>{member.open} open · {member.dueThisWeek} due this week{member.overdue ? ` · ${member.overdue} overdue` : ""}</span>
                </div>
                <div className="workload-bar" aria-hidden><span style={{ width: `${percent(member.estimateMinutes, maxEstimate)}%` }} /></div>
                <span className="workload-time">{member.estimateMinutes ? `${Math.round(member.estimateMinutes / 60 * 10) / 10}h` : "—"}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card card-pad" aria-labelledby="workload-boards-title">
          <div className="section-head">
            <div>
              <h2 className="section-title" id="workload-boards-title">Board health</h2>
              <p className="section-subtitle">Where work is accumulating.</p>
            </div>
            <BarChart3 size={17} aria-hidden style={{ color: "var(--faint)" }} />
          </div>
          {data.boards.length ? (
            <div className="board-health-list">
              {data.boards.map((board) => (
                <div className="board-health-row" key={board.id}>
                  <div className="workload-copy">
                    <strong>{board.name}</strong>
                    <span>{board.open} open · {board.done} done{board.overdue ? ` · ${board.overdue} overdue` : ""}</span>
                  </div>
                  <div className="workload-bar" aria-hidden><span style={{ width: `${percent(board.estimateMinutes, maxBoard)}%` }} /></div>
                  <span className="workload-time">{board.estimateMinutes ? `${Math.round(board.estimateMinutes / 60 * 10) / 10}h` : "—"}</span>
                </div>
              ))}
            </div>
          ) : <p className="field-hint">No active boards yet.</p>}
        </section>
      </div>

      <section className="card card-pad" style={{ marginTop: 18 }} aria-labelledby="workload-focus-title">
        <div className="section-head">
          <div>
            <h2 className="section-title" id="workload-focus-title">A sensible focus</h2>
            <p className="section-subtitle">Highest priority and nearest dates. Suggestions, never automatic moves.</p>
          </div>
        </div>
        {focus.length ? (
          <div className="unscheduled-list">
            {focus.map((task) => (
              <button type="button" className="slim-task" key={task.id} onClick={() => onOpenTask(task.id)}>
                <PriorityBadge priority={task.priority} compact />
                <span className="slim-title">{task.title}</span>
                <span className="task-foot-meta">{task.dueDate ? formatDate(task.dueDate, { month: "short", day: "numeric" }) : "No date"} · {task.boardName}</span>
              </button>
            ))}
          </div>
        ) : <p className="field-hint">Nothing open. Enjoy the quiet.</p>}
      </section>
    </>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: string | number; note: string; tone?: "rose" | "amber" | "moss" }) {
  return (
    <div className={`metric-card${tone ? ` ${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
