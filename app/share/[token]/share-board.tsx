"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, CheckCircle2, Eye, LayoutGrid, Lock, Sparkles } from "lucide-react";
import { PriorityBadge, LabelChip, Spinner } from "@/components/ui";
import { formatDue, formatDate } from "@/lib/format";
import type { Label } from "@/lib/types";

type SharedTask = {
  id: string;
  columnId: string;
  title: string;
  description: string;
  priority: string;
  dueDate: string | null;
  completedAt: string | null;
  assignee: { name: string; avatarUrl?: string | null } | null;
  labels: Label[];
  subtasks: { id: string; title: string; completed: boolean }[];
};

type SharedBoardPayload = {
  board: {
    name: string;
    description: string;
    workspaceName: string;
    updatedAt: string;
    columns: { id: string; name: string; wipLimit: number | null; isDone: boolean }[];
    tasks: SharedTask[];
  };
};

export function ShareBoard({ token }: { token: string }) {
  const [data, setData] = useState<SharedBoardPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/share/${encodeURIComponent(token)}`, { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message ?? "This board is not available.");
        if (!cancelled) setData(payload as SharedBoardPayload);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "This board is not available.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return <main className="share-page" id="main"><div className="share-header"><Link className="brand" href="/">Drift</Link></div><div className="content" style={{ paddingTop: 60 }}><Spinner label="Opening shared board" /></div></main>;
  }

  if (error || !data) {
    return (
      <main className="share-page" id="main">
        <header className="share-header"><Link className="brand" href="/"><span className="brand-mark" aria-hidden><Sparkles size={13} /></span> Drift</Link><span className="badge slate"><Lock size={10} /> Private by default</span></header>
        <div className="content narrow" style={{ paddingTop: 70, textAlign: "center" }}>
          <div className="empty" style={{ margin: "0 auto" }}>
            <span className="empty-mark"><Lock size={20} /></span>
            <h3>This board is not shared</h3>
            <p>{error || "The link may have been turned off. Ask the owner for a new share link."}</p>
            <Link className="btn primary" href="/">Open Drift <ArrowUpRight size={13} /></Link>
          </div>
        </div>
      </main>
    );
  }

  const { board } = data;
  const done = board.tasks.filter((task) => task.completedAt).length;

  return (
    <main className="share-page" id="main">
      <header className="share-header">
        <Link className="brand" href="/"><span className="brand-mark" aria-hidden><Sparkles size={13} /></span> Drift</Link>
        <span className="badge slate"><Eye size={10} /> Read-only share</span>
      </header>
      <div className="share-content">
        <div className="page-head" style={{ marginBottom: 22 }}>
          <div>
            <div className="eyebrow"><LayoutGrid size={12} /> {board.workspaceName}</div>
            <h1 className="page-title">{board.name}</h1>
            {board.description ? <p className="page-subtitle">{board.description}</p> : <p className="page-subtitle">A quiet, read-only view of this board.</p>}
          </div>
          <div className="inline"><span className="badge slate">{board.tasks.length} tasks</span><span className="badge accent"><CheckCircle2 size={10} /> {done} done</span><span className="badge slate" title={board.updatedAt}><CalendarDays size={10} /> Updated {formatDate(board.updatedAt, { month: "short", day: "numeric" })}</span></div>
        </div>
        <div className="share-canvas" role="list" aria-label={`${board.name} columns`}>
          {board.columns.map((column) => {
            const tasks = board.tasks.filter((task) => task.columnId === column.id);
            return (
              <section className="share-column" key={column.id} role="listitem" aria-label={column.name}>
                <div className="column-head" style={{ cursor: "default" }}>
                  <span className="column-name"><span className={`column-dot${column.isDone ? " done" : ""}`} aria-hidden />{column.name}</span>
                  <span className="column-count">{tasks.length}{column.wipLimit ? ` / ${column.wipLimit}` : ""}</span>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {tasks.map((task) => (
                    <article className={`task-card${task.completedAt ? " completed" : ""}`} key={task.id} style={{ cursor: "default" }}>
                      <div className="task-title-row"><h3 className="task-title">{task.title}</h3><PriorityBadge priority={task.priority} compact /></div>
                      {task.description ? <p className="task-desc">{task.description.slice(0, 260)}</p> : null}
                      {task.labels.length ? <div className="label-row">{task.labels.slice(0, 3).map((label) => <LabelChip key={label.id} label={label} />)}</div> : null}
                      <div className="task-meta">
                        {task.dueDate ? <span className={`task-chip${task.completedAt ? "" : " due"}`}><CalendarDays size={10} /> {formatDue(task.dueDate, true)}</span> : null}
                        {task.subtasks.length ? <span className="task-chip">{task.subtasks.filter((subtask) => subtask.completed).length}/{task.subtasks.length}</span> : null}
                        <span style={{ flex: 1 }} />
                        {task.assignee ? <span className="task-chip" title={task.assignee.name}>{initials(task.assignee.name)}</span> : null}
                      </div>
                    </article>
                  ))}
                  {!tasks.length ? <p className="field-hint" style={{ padding: "10px 2px" }}>Nothing here.</p> : null}
                </div>
              </section>
            );
          })}
        </div>
        <footer className="field-hint" style={{ marginTop: 30, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <span>Shared read-only by {board.workspaceName}. No email addresses or comments are exposed.</span>
          <a href="/auth?mode=signup">Make your own calm board <ArrowUpRight size={11} /></a>
        </footer>
      </div>
    </main>
  );
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}
