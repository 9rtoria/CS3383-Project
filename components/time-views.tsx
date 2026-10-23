"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus, SunMedium } from "lucide-react";
import { EmptyState, PriorityBadge } from "@/components/ui";
import { api, formatApiError } from "@/lib/client";
import { formatTime, parseDateOnly, priorityLabel } from "@/lib/format";
import type { Task, UpcomingPayload, Workspace } from "@/lib/types";

export function UpcomingView({ workspace, refreshKey, onOpenTask, onQuickCapture }: {
  workspace: Workspace;
  refreshKey: number;
  onOpenTask: (taskId: string) => void;
  onQuickCapture: () => void;
}) {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<UpcomingPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<UpcomingPayload>(`/api/upcoming?days=${days}&workspaceId=${encodeURIComponent(workspace.id)}`, { workspaceId: workspace.id }));
      setError("");
    } catch (loadError) {
      setError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }, [days, workspace.id]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const entries = useMemo(() => Object.entries(data?.grouped ?? {}).sort(([a], [b]) => a.localeCompare(b)), [data]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><CalendarDays size={12} /> Planning horizon</div>
          <h1 className="page-title">Upcoming</h1>
          <p className="page-subtitle">A gentle look forward. Nothing here is on fire yet — that&apos;s the point.</p>
        </div>
        <div className="page-actions">
          <div className="segmented" role="group" aria-label="Upcoming range">
            {[7, 14, 30].map((value) => (
              <button key={value} type="button" className={days === value ? "active" : ""} onClick={() => setDays(value)} aria-pressed={days === value}>{value} days</button>
            ))}
          </div>
          <button type="button" className="btn primary" onClick={onQuickCapture}><Plus size={14} /> New task</button>
        </div>
      </div>

      {data && data.count === 0 && !loading ? (
        <EmptyState icon={<SunMedium size={20} />} title="Nothing scheduled ahead" description="The horizon is clear. Add a date when something actually needs one — not before." action={<button type="button" className="btn primary" onClick={onQuickCapture}><Plus size={14} /> Add a dated task</button>} />
      ) : entries.length ? (
        <div>
          {entries.map(([date, tasks]) => {
            const parsed = parseDateOnly(date);
            const isToday = date === data?.today;
            return (
              <section className="upcoming-day" key={date}>
                <div className="upcoming-day-label">
                  <strong>{isToday ? "Today" : parsed.toLocaleDateString(undefined, { day: "numeric" })}</strong>
                  {parsed.toLocaleDateString(undefined, { weekday: "long", month: "short" })}
                  <div style={{ color: "var(--faint)", marginTop: 3 }}>{tasks.length} task{tasks.length === 1 ? "" : "s"}</div>
                </div>
                <div className="upcoming-tasks">
                  {tasks.map((task) => (
                    <button type="button" className="slim-task" key={task.id} onClick={() => onOpenTask(task.id)}>
                      <span className={`side-dot${isToday ? " today" : ""}`} aria-hidden />
                      <span className="slim-title">{task.title}</span>
                      <PriorityBadge priority={task.priority} compact />
                      {task.dueDate && !task.dueAllDay ? <span className="task-foot-meta"><Clock3 size={10} /> {formatTime(task.dueDate)}</span> : null}
                      {task.labels.slice(0, 2).map((label) => <span className={`badge ${label.color}`} key={label.id}>{label.name}</span>)}
                      <span className="task-foot-meta" style={{ minWidth: 90, justifyContent: "flex-end" }}>{task.board?.name}</span>
                      <ChevronRight size={14} aria-hidden style={{ color: "var(--faint)" }} />
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
          <div className="inline" style={{ marginTop: 20 }}>
            <span className="field-hint">Showing tasks due through {parseDateOnly(data?.end ?? "").toLocaleDateString(undefined, { month: "long", day: "numeric" })}. Overdue work lives in Today and Search.</span>
            <button type="button" className="btn ghost sm" onClick={() => setDays((value) => (value === 14 ? 30 : 14))}>Change range <ArrowRight size={12} /></button>
          </div>
        </div>
      ) : loading ? (
        <div className="stack">{[0, 1, 2].map((item) => <div className="skeleton" key={item} style={{ height: 92, borderRadius: 12 }} />)}</div>
      ) : (
        <EmptyState icon={<CalendarDays size={20} />} title="Couldn’t load your upcoming tasks" description={error} action={<button type="button" className="btn primary" onClick={() => void load()}>Try again</button>} />
      )}
    </>
  );
}

export function CalendarView({ workspace, refreshKey, onOpenTask, onQuickCapture }: {
  workspace: Workspace;
  refreshKey: number;
  onOpenTask: (taskId: string) => void;
  onQuickCapture: () => void;
}) {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [data, setData] = useState<import("@/lib/types").CalendarPayload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api(`/api/calendar?month=${month}&workspaceId=${encodeURIComponent(workspace.id)}`, { workspaceId: workspace.id }));
      setError("");
    } catch (loadError) {
      setError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }, [month, workspace.id]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const cells = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    const first = new Date(year!, monthNumber! - 1, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const start = new Date(year!, monthNumber! - 1, 1 - startOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return { date, key, outside: date.getMonth() !== monthNumber! - 1 };
    });
  }, [month]);

  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const selectedTasks = selected ? data?.byDate[selected] ?? [] : [];
  const monthLabel = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  function shift(delta: number) {
    const [year, monthNumber] = month.split("-").map(Number);
    const date = new Date(year!, monthNumber! - 1 + delta, 1);
    setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
    setSelected(null);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><CalendarDays size={12} /> Time, at a glance</div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-subtitle">Dates are commitments; everything else can stay flexible.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => { const current = new Date(); setMonth(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`); }}>Today</button>
          <button type="button" className="btn primary" onClick={onQuickCapture}><Plus size={14} /> New task</button>
        </div>
      </div>

      <div className="calendar-layout">
        <div className="calendar">
          <div className="calendar-head">
            <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
            <button type="button" className="icon-btn" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={16} /></button>
            <h2 className="calendar-title">{monthLabel}</h2>
            <span className="badge slate">{data?.total ?? 0} dated</span>
          </div>
          <div className="calendar-weekdays" aria-hidden>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="calendar-grid">
            {cells.map((cell) => {
              const tasks = data?.byDate[cell.key] ?? [];
              const dayLabel = cell.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
              return (
                <div
                  key={cell.key}
                  className={`calendar-day${cell.outside ? " outside" : ""}${cell.key === todayKey ? " today" : ""}`}
                >
                  <button
                    type="button"
                    className="day-select"
                    aria-label={`${dayLabel}, ${tasks.length} tasks`}
                    aria-pressed={selected === cell.key}
                    onClick={() => setSelected(cell.key)}
                  >
                    <span className="day-number">{cell.date.getDate()}</span>
                  </button>
                  <div className="day-tasks">
                    {tasks.slice(0, 3).map((task) => (
                      <button type="button" className="day-task" key={task.id} onClick={() => onOpenTask(task.id)}>
                        <span className={`side-dot${task.completedAt ? "" : task.priority === "urgent" || task.priority === "high" ? " over" : " week"}`} aria-hidden />
                        <span className="day-task-title">{task.title}</span>
                      </button>
                    ))}
                    {tasks.length > 3 ? (
                      <button type="button" className="day-more" onClick={() => setSelected(cell.key)}>
                        +{tasks.length - 3} more
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="today-side calendar-side">
          <div className="card side-card">
            <div className="section-head" style={{ marginBottom: 8 }}>
              <h2 className="section-title">{selected ? parseDateOnly(selected).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "Pick a day"}</h2>
            </div>
            {selected ? (
              selectedTasks.length ? (
                <div className="upcoming-tasks">
                  {selectedTasks.map((task) => (
                    <button type="button" className="slim-task" key={task.id} onClick={() => onOpenTask(task.id)} style={{ padding: "7px 9px" }}>
                      <span className={`side-dot${task.completedAt ? "" : " today"}`} aria-hidden />
                      <span className="slim-title">{task.title}</span>
                    </button>
                  ))}
                </div>
              ) : <p className="section-subtitle" style={{ margin: 0 }}>Nothing due. Keep it that way if you can.</p>
            ) : <p className="section-subtitle" style={{ margin: 0 }}>Select a date to read it without the grid.</p>}
          </div>
          <div className="card side-card">
            <h2 className="section-title" style={{ marginBottom: 8 }}>Dated tasks</h2>
            <p className="section-subtitle" style={{ margin: 0, lineHeight: 1.6 }}>
              {loading ? "Loading…" : error ? error : `${data?.total ?? 0} tasks have a due date this month. Undated work stays on its board, where it belongs.`}
            </p>
            {error ? <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={() => void load()}>Retry</button> : null}
          </div>
          <div className="card quote-card"><p>“A calendar is a promise to your future self.”</p><span>Keep promises small enough to keep.</span></div>
        </aside>
      </div>
    </>
  );
}
