"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowUpRight, CheckCircle2, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { EmptyState, PriorityBadge } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, formatApiError } from "@/lib/client";
import { formatDue, isOverdue } from "@/lib/format";
import type { ArchivePayload, SearchPayload, Task, Workspace } from "@/lib/types";

const STATUSES = [
  { id: "all", label: "Everything" },
  { id: "open", label: "Open" },
  { id: "done", label: "Done" },
  { id: "overdue", label: "Overdue" },
] as const;

export function SearchView({ workspace, refreshKey, onOpenTask, onNavigateBoard }: {
  workspace: Workspace;
  refreshKey: number;
  onOpenTask: (taskId: string) => void;
  onNavigateBoard: (boardId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]["id"]>("all");
  const [priority, setPriority] = useState("all");
  const [boardId, setBoardId] = useState("all");
  const [data, setData] = useState<SearchPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, []);

  const load = useCallback(async (cursor?: string | null) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ workspaceId: workspace.id, status, limit: "30" });
      if (query.trim()) params.set("q", query.trim());
      if (priority !== "all") params.set("priority", priority);
      if (boardId !== "all") params.set("boardId", boardId);
      if (cursor) params.set("cursor", cursor);
      const payload = await api<SearchPayload>(`/api/search?${params.toString()}`, { workspaceId: workspace.id });
      if (seq === requestSeq.current) {
        setData((current) => (cursor && current ? { ...payload, results: [...current.results, ...payload.results] } : payload));
        setError("");
      }
    } catch (loadError) {
      if (seq === requestSeq.current) setError(formatApiError(loadError));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [boardId, priority, query, status, workspace.id]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 220);
    return () => clearTimeout(timer);
  }, [load, refreshKey]);

  const filtersActive = query.trim() || status !== "all" || priority !== "all" || boardId !== "all";

  return (
    <div className="search-page">
      <div className="page-head" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow"><Search size={12} /> Find anything</div>
          <h1 className="page-title">Search</h1>
          <p className="page-subtitle">Full-text across every board you can see. Press <span className="kbd">/</span> anywhere to come back here.</p>
        </div>
      </div>

      <div className="search-box">
        <Search size={19} aria-hidden style={{ color: "var(--muted)" }} />
        <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles, descriptions and labels…" aria-label="Search tasks" />
        {query ? <button type="button" className="icon-btn sm" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button> : <span className="kbd">/</span>}
      </div>

      <div className="search-filters" role="group" aria-label="Search filters">
        {STATUSES.map((item) => (
          <button type="button" key={item.id} className={`filter-chip${status === item.id ? " active" : ""}`} aria-pressed={status === item.id} onClick={() => setStatus(item.id)}>{item.label}</button>
        ))}
        <span style={{ width: 1, background: "var(--border)", margin: "0 3px" }} aria-hidden />
        <select className="select" value={priority} onChange={(event) => setPriority(event.target.value)} style={{ width: 128, minHeight: 28, fontSize: 11, padding: "2px 26px 2px 9px" }} aria-label="Filter by priority">
          <option value="all">Any priority</option>
          {["urgent", "high", "medium", "low", "none"].map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}
        </select>
        <select className="select" value={boardId} onChange={(event) => setBoardId(event.target.value)} style={{ width: 150, minHeight: 28, fontSize: 11, padding: "2px 26px 2px 9px" }} aria-label="Filter by board">
          <option value="all">Any board</option>
          {workspace.boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
        </select>
        {filtersActive ? <button type="button" className="btn ghost sm" onClick={() => { setQuery(""); setStatus("all"); setPriority("all"); setBoardId("all"); }}><X size={12} /> Reset</button> : null}
      </div>

      {data ? (
        <div className="inline" style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <span className="section-subtitle">{data.total} result{data.total === 1 ? "" : "s"}{query ? ` for “${query.trim()}”` : " · most recently touched"}</span>
          <span className="badge slate"><SlidersHorizontal size={10} /> {loading ? "Searching…" : `${status === "all" ? "all statuses" : status}`}</span>
        </div>
      ) : null}

      <div>
        {data?.results.map((task) => (
          <button type="button" className="result-row" key={task.id} onClick={() => onOpenTask(task.id)}>
            <span className={`result-icon${task.archivedAt ? " archived" : ""}`} aria-hidden>{task.archivedAt ? <Archive size={14} /> : task.completedAt ? <CheckCircle2 size={14} /> : <Search size={14} />}</span>
            <span className="result-main">
              <span className="result-title">{task.title}</span>
              {task.description ? <span className="result-snippet">{task.description}</span> : null}
              <span className="result-meta" style={{ marginLeft: 0, textAlign: "left", marginTop: 5, display: "flex", gap: 7, flexWrap: "wrap", whiteSpace: "normal" }}>
                <span className="badge slate">{task.board?.name ?? "Board"}</span>
                <span className="badge slate">{task.column?.name ?? "Column"}</span>
                {task.dueDate ? <span className={`badge ${isOverdue(task.dueDate, task.completedAt) ? "rose" : "slate"}`}>{formatDue(task.dueDate, task.dueAllDay)}</span> : null}
                {task.checklist.total ? <span className="badge slate">{task.checklist.done}/{task.checklist.total}</span> : null}
              </span>
            </span>
            <span className="result-meta">
              <PriorityBadge priority={task.priority} compact />
              <div style={{ marginTop: 5 }}>{task.completedAt ? "Done" : "Open"}</div>
              <div style={{ marginTop: 3 }}>{task.assignee?.name ?? ""}</div>
            </span>
          </button>
        ))}
      </div>

      {!loading && data && data.results.length === 0 ? (
        <EmptyState icon={<Search size={20} />} title={query ? "No matching tasks" : "A quiet archive"} description={query ? "Try fewer words, a different status, or search an older board." : "Nothing here yet. Capture a task and it becomes searchable instantly."} />
      ) : null}
      {error ? <EmptyState icon={<Search size={20} />} title="Search is unavailable" description={error} action={<button type="button" className="btn primary" onClick={() => void load()}>Try again</button>} /> : null}
      {data?.nextCursor ? <button type="button" className="btn block" style={{ marginTop: 14 }} onClick={() => void load(data.nextCursor)} disabled={loading}>{loading ? "Loading…" : "Load more"}</button> : null}
      <p className="field-hint" style={{ textAlign: "center", marginTop: 24 }}>Search is scoped to {workspace.name}. Private boards only appear if they are yours.</p>
      <button type="button" className="btn ghost sm" style={{ display: "block", margin: "8px auto 0" }} onClick={() => { const first = workspace.boards[0]; if (first) onNavigateBoard(first.id); }}>
        Open a board <ArrowUpRight size={12} />
      </button>
    </div>
  );
}

export function ArchiveView({ workspace, refreshKey, onOpenTask, onChanged }: {
  workspace: Workspace;
  refreshKey: number;
  onOpenTask: (taskId: string) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<ArchivePayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<ArchivePayload>(`/api/archive?workspaceId=${encodeURIComponent(workspace.id)}`, { workspaceId: workspace.id }));
      setError("");
    } catch (loadError) {
      setError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function restoreTask(task: Task, mode: "archive" | "complete") {
    setBusy(task.id);
    try {
      await api(`/api/tasks/${task.id}`, {
        method: "PATCH",
        workspaceId: workspace.id,
        body: mode === "archive" ? { archived: false, version: task.version } : { completed: false, version: task.version },
      });
      toast.success(mode === "archive" ? "Task restored to its board." : "Task reopened.");
      await load();
      onChanged();
    } catch (restoreError) {
      toast.error(formatApiError(restoreError));
    } finally {
      setBusy(null);
    }
  }

  async function restoreBoard(board: ArchivePayload["archivedBoards"][number]) {
    setBusy(board.id);
    try {
      await api(`/api/boards/${board.id}`, { method: "PATCH", workspaceId: workspace.id, body: { archived: false, version: board.version } });
      toast.success("Board restored.");
      await load();
      onChanged();
    } catch (restoreError) {
      toast.error(formatApiError(restoreError));
    } finally {
      setBusy(null);
    }
  }

  const completedOnly = (data?.archivedTasks ?? []).filter((task) => task.completedAt && !task.archivedAt);
  const archived = (data?.archivedTasks ?? []).filter((task) => task.archivedAt);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Archive size={12} /> Out of the way, not gone</div>
          <h1 className="page-title">Archive</h1>
          <p className="page-subtitle">Completed and archived work. Restore anything you still need; the rest can stay quiet.</p>
        </div>
      </div>

      {error ? <EmptyState icon={<Archive size={20} />} title="Archive unavailable" description={error} action={<button type="button" className="btn primary" onClick={() => void load()}>Try again</button>} /> : null}

      {data?.archivedBoards.length ? (
        <section style={{ marginBottom: 30 }}>
          <div className="section-head"><div><h2 className="section-title">Archived boards</h2><p className="section-subtitle">Whole boards, folded away.</p></div></div>
          <div className="settings-card">
            {data.archivedBoards.map((board) => (
              <div className="settings-row" key={board.id}>
                <div className="settings-copy"><strong>{board.name}</strong><span>{board.taskCount} tasks · archived {formatDue(board.archivedAt)}</span></div>
                <div className="settings-control"><button type="button" className="btn sm" onClick={() => void restoreBoard(board)} disabled={busy === board.id}><RotateCcw size={12} /> Restore</button></div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section style={{ marginBottom: 30 }}>
        <div className="section-head"><div><h2 className="section-title">Archived tasks</h2><p className="section-subtitle">{archived.length} task{archived.length === 1 ? "" : "s"} put away explicitly.</p></div></div>
        {archived.length ? (
          <div className="settings-card">
            {archived.map((task) => (
              <div className="settings-row" key={task.id}>
                <div className="settings-copy"><strong>{task.title}</strong><span>{task.board?.name} · {task.archivedAt ? formatDue(task.archivedAt) : ""}</span></div>
                <div className="settings-control inline">
                  <button type="button" className="btn ghost sm" onClick={() => onOpenTask(task.id)}>Open</button>
                  <button type="button" className="btn sm" onClick={() => void restoreTask(task, "archive")} disabled={busy === task.id}><RotateCcw size={12} /> Restore</button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="section-subtitle">{loading ? "Loading…" : "Nothing archived. A clean shelf."}</p>}
      </section>

      <section>
        <div className="section-head"><div><h2 className="section-title">Completed</h2><p className="section-subtitle">{completedOnly.length} finished task{completedOnly.length === 1 ? "" : "s"}. Reopen one if it wasn&apos;t really done.</p></div></div>
        {completedOnly.length ? (
          <div className="settings-card">
            {completedOnly.map((task) => (
              <div className="settings-row" key={task.id}>
                <div className="settings-copy"><strong>{task.title}</strong><span>{task.board?.name} · completed {formatDue(task.completedAt)}</span></div>
                <div className="settings-control inline">
                  <button type="button" className="btn ghost sm" onClick={() => onOpenTask(task.id)}>Open</button>
                  <button type="button" className="btn sm" onClick={() => void restoreTask(task, "complete")} disabled={busy === task.id}><RotateCcw size={12} /> Reopen</button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="section-subtitle">{loading ? "Loading…" : "No completed tasks yet. They’ll collect here without judgment."}</p>}
      </section>
    </>
  );
}
