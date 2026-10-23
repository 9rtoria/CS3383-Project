"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Archive,
  ArrowRightLeft,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Filter,
  GripVertical,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Avatar, EmptyState, InlineError, LabelChip, LoadingButton, Menu, MenuItem, Modal, PriorityBadge, Spinner } from "@/components/ui";
import { TaskCard } from "@/components/task-card";
import { useToast } from "@/components/toast";
import { ApiClientError, api, formatApiError, newIdempotencyKey } from "@/lib/client";
import { enqueueWrite } from "@/lib/offline";
import { parseQuickAdd } from "@/lib/nlq";
import { formatDue, isOverdue, priorityLabel } from "@/lib/format";
import type { BoardColumn, BoardPayload, Task, Workspace } from "@/lib/types";

type Props = {
  workspace: Workspace;
  boardId: string;
  refreshKey: number;
  timeZone: string;
  currentUserId: string;
  onOpenTask: (taskId: string) => void;
  onQuickCapture: () => void;
  onNewBoard: () => void;
  onChanged: () => void;
  onOpenBoard: (boardId: string) => void;
};

const SAVED_MODE = "drift-board-mode";

export function BoardView({ workspace, boardId, refreshKey, timeZone, currentUserId, onOpenTask, onQuickCapture, onNewBoard, onChanged, onOpenBoard }: Props) {
  const toast = useToast();
  const [data, setData] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [mode, setMode] = useState<"board" | "list">("board");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [addingColumn, setAddingColumn] = useState<string | null>(null);
  const [columnEditor, setColumnEditor] = useState<{ mode: "new" | "edit"; column?: BoardColumn} | null>(null);
  const [boardSettingsOpen, setBoardSettingsOpen] = useState(false);
  const [busyMove, setBusyMove] = useState<string | null>(null);
  const loadSeq = useRef(0);

  useEffect(() => {
    const stored = localStorage.getItem(SAVED_MODE);
    if (stored === "list" || stored === "board") setMode(stored);
  }, []);

  const loadBoard = useCallback(
    async (silent = false) => {
      const seq = ++loadSeq.current;
      if (!silent) setLoading(true);
      try {
        const payload = await api<BoardPayload>(`/api/boards/${boardId}`, { workspaceId: workspace.id });
        if (seq === loadSeq.current) {
          setData(payload);
          setError("");
        }
      } catch (loadError) {
        if (seq === loadSeq.current) setError(formatApiError(loadError));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [boardId, workspace.id],
  );

  useEffect(() => {
    void loadBoard();
  }, [loadBoard, refreshKey]);

  useEffect(() => {
    setQuery("");
    setPriority("all");
    setAssignee("all");
  }, [boardId]);

  const members = data?.members ?? [];
  const tasks = data?.tasks ?? [];
  const columns = useMemo(() => [...(data?.board.columns ?? [])].sort((a, b) => (a.position ?? "").localeCompare(b.position ?? "")), [data]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (needle && !`${task.title} ${task.description}`.toLowerCase().includes(needle)) return false;
      if (priority !== "all" && task.priority !== priority) return false;
      if (assignee === "mine" && task.assignee?.id !== currentUserId) return false;
      if (assignee === "unassigned" && task.assignee) return false;
      if (assignee !== "all" && assignee !== "unassigned" && assignee !== "mine" && task.assignee?.id !== assignee) return false;
      return true;
    });
  }, [assignee, currentUserId, priority, query, tasks]);

  const activeFilters = query || priority !== "all" || assignee !== "all";

  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const column of columns) map.set(column.id, []);
    for (const task of filtered) {
      const list = map.get(task.columnId);
      if (list) list.push(task);
    }
    for (const list of map.values()) list.sort((a, b) => (a.position === b.position ? a.id.localeCompare(b.id) : a.position.localeCompare(b.position)));
    return map;
  }, [columns, filtered]);

  function chooseMode(next: "board" | "list") {
    setMode(next);
    localStorage.setItem(SAVED_MODE, next);
  }

  async function moveTask(task: Task, targetColumnId: string, beforeId: string | null, afterId: string | null) {
    if (busyMove) return;
    if (task.columnId === targetColumnId && !beforeId && !afterId) return;
    setBusyMove(task.id);
    const moveBody = { columnId: targetColumnId, beforeId, afterId, version: task.version };
    const idempotencyKey = newIdempotencyKey("move");
    setData((current) => {
      if (!current) return current;
      const targetColumn = current.board.columns.find((column) => column.id === targetColumnId);
      const nextTask = { ...task, columnId: targetColumnId, column: targetColumn ? { id: targetColumn.id, name: targetColumn.name, isDone: targetColumn.isDone } : task.column, completedAt: targetColumn?.isDone ? task.completedAt ?? new Date().toISOString() : null };
      const others = current.tasks.filter((item) => item.id !== task.id);
      return { ...current, tasks: [...others, nextTask] };
    });
    try {
      const result = await api<{ task: Task; nextTaskId?: string }>(`/api/tasks/${task.id}/move`, {
        method: "PATCH",
        workspaceId: workspace.id,
        idempotencyKey,
        body: moveBody,
      });
      setData((current) => current ? { ...current, tasks: current.tasks.map((item) => (item.id === task.id ? { ...result.task, commentCount: item.commentCount, attachmentCount: item.attachmentCount, openDependencies: item.openDependencies } : item)) } : current);
      const columnName = result.task.column?.name ?? columns.find((column) => column.id === targetColumnId)?.name ?? "column";
      setAnnouncement(`Moved ${result.task.title} to ${columnName}.`);
      toast.push({ message: `Moved to ${columnName}`, tone: "success", actionLabel: "Undo", onAction: async () => {
        const undoId = (result as unknown as { undo?: { id?: string } }).undo?.id;
        if (undoId) await api(`/api/undo/${undoId}`, { method: "POST", workspaceId: workspace.id, body: {} });
        await loadBoard(true);
        onChanged();
      }});
      onChanged();
      if (result.nextTaskId) void loadBoard(true);
    } catch (moveError) {
      if (moveError instanceof ApiClientError && moveError.code === "NETWORK_ERROR") {
        enqueueWrite({
          kind: "task.move",
          label: task.title,
          path: `/api/tasks/${task.id}/move`,
          method: "PATCH",
          body: moveBody,
          workspaceId: workspace.id,
          idempotencyKey,
        });
        const targetName = columns.find((column) => column.id === targetColumnId)?.name ?? "column";
        setAnnouncement(`Move to ${targetName} saved on this device. It will sync when you reconnect.`);
        toast.push({ message: "Move saved on this device. It will sync when you reconnect.", duration: 4500 });
        return;
      }
      toast.error(formatApiError(moveError));
      setAnnouncement("Move failed. The task returned to its original column.");
      void loadBoard(true);
    } finally {
      setBusyMove(null);
    }
  }

  function dropHandlers(columnId: string) {
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropColumn(columnId);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropColumn((current) => (current === columnId ? null : current));
      },
      onDrop: async (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        setDropColumn(null);
        const id = event.dataTransfer.getData("text/plain") || draggingId;
        const task = tasks.find((item) => item.id === id);
        if (!task || !data) return;
        await moveTask(task, columnId, null, null);
        setDraggingId(null);
      },
    };
  }

  async function dropOnCard(event: DragEvent<HTMLElement>, target: Task) {
    event.preventDefault();
    event.stopPropagation();
    const id = event.dataTransfer.getData("text/plain") || draggingId;
    const task = tasks.find((item) => item.id === id);
    if (!task || task.id === target.id) return;
    const list = grouped.get(target.columnId)?.filter((item) => item.id !== task.id) ?? [];
    const index = list.findIndex((item) => item.id === target.id);
    const rect = event.currentTarget.getBoundingClientRect();
    const afterHalf = event.clientY > rect.top + rect.height / 2;
    const insertion = afterHalf ? index + 1 : index;
    const afterId = list[insertion - 1]?.id ?? null;
    const beforeId = list[insertion]?.id ?? null;
    setDraggingId(null);
    setDropColumn(null);
    await moveTask(task, target.columnId, beforeId, afterId);
  }

  async function keyboardMove(task: Task, event: React.KeyboardEvent<HTMLElement>) {
    if (!event.altKey) return;
    const direction = event.key;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(direction)) return;
    event.preventDefault();
    const columnIndex = columns.findIndex((column) => column.id === task.columnId);
    if (columnIndex < 0) return;
    if (direction === "ArrowLeft" || direction === "ArrowRight") {
      const nextIndex = columnIndex + (direction === "ArrowRight" ? 1 : -1);
      const target = columns[nextIndex];
      if (!target) return;
      const targetList = (grouped.get(target.id) ?? []).filter((item) => item.id !== task.id);
      const insertion = Math.min((grouped.get(task.columnId) ?? []).findIndex((item) => item.id === task.id), targetList.length);
      await moveTask(task, target.id, targetList[insertion]?.id ?? null, targetList[insertion - 1]?.id ?? null);
      return;
    }
    const list = (grouped.get(task.columnId) ?? []).filter((item) => item.id !== task.id);
    const currentIndex = (grouped.get(task.columnId) ?? []).findIndex((item) => item.id === task.id);
    const insertion = direction === "ArrowUp" ? Math.max(0, currentIndex - 1) : Math.min(list.length, currentIndex + 1);
    await moveTask(task, task.columnId, list[insertion]?.id ?? null, list[insertion - 1]?.id ?? null);
  }

  if (loading && !data) {
    return (
      <div aria-busy="true" aria-label="Loading board">
        <div className="skeleton" style={{ width: 220, height: 38, marginBottom: 12 }} />
        <div style={{ display: "flex", gap: 14 }}>
          {[0, 1, 2].map((item) => <div key={item} className="skeleton" style={{ width: 302, height: 360, borderRadius: 12 }} />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<LayoutGrid size={20} />}
        title="This board didn’t load"
        description={error || "The board may have moved or your role may have changed."}
        action={<button type="button" className="btn primary" onClick={() => void loadBoard()}>Try again</button>}
      />
    );
  }

  const openCount = filtered.filter((task) => !task.completedAt).length;
  const completedCount = filtered.length - openCount;

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">
            <span>{workspace.name}</span>
            <span aria-hidden>·</span>
            <span>{data.board.visibility === "private" ? "Private board" : "Shared with workspace"}</span>
          </div>
          <h1 className="page-title">{data.board.name}</h1>
          <p className="page-subtitle">
            {data.board.description || "A quiet place to move work forward."}{" "}
            <span style={{ color: "var(--faint)" }}>· {openCount} open{completedCount ? ` · ${completedCount} done` : ""}</span>
          </p>
        </div>
        <div className="page-actions">
          <div className="segmented" role="group" aria-label="Board view">
            <button type="button" className={mode === "board" ? "active" : ""} onClick={() => chooseMode("board")} aria-pressed={mode === "board"}>
              <LayoutGrid size={13} aria-hidden /> Board
            </button>
            <button type="button" className={mode === "list" ? "active" : ""} onClick={() => chooseMode("list")} aria-pressed={mode === "list"}>
              <List size={13} aria-hidden /> List
            </button>
          </div>
          <button type="button" className="btn primary" onClick={onQuickCapture}>
            <Plus size={14} aria-hidden /> New task <span className="kbd" style={{ background: "transparent", color: "inherit", borderColor: "currentColor", opacity: 0.6 }}>C</span>
          </button>
          <Menu trigger={<MoreHorizontal size={17} />} triggerLabel="Board actions">
            {(close) => (
              <>
                <MenuItem icon={<Settings2 size={14} />} onClick={() => { close(); setBoardSettingsOpen(true); }}>Board settings</MenuItem>
                <MenuItem icon={<Copy size={14} />} onClick={async () => { close(); try { const result = await api<{ board: { id: string } }>(`/api/boards/${data.board.id}/duplicate`, { method: "POST", workspaceId: workspace.id, body: {} }); toast.success("Board duplicated."); onChanged(); onOpenBoard(result.board.id); } catch (duplicateError) { toast.error(formatApiError(duplicateError)); } }}>Duplicate board</MenuItem>
                <MenuItem icon={<Share2 size={14} />} onClick={async () => { close(); await toggleShare(); }}>{data.board.shareEnabled ? "Manage public link" : "Share read-only link"}</MenuItem>
                <div className="menu-sep" />
                <MenuItem icon={<Archive size={14} />} onClick={async () => { close(); await archiveBoard(); }}>Archive board</MenuItem>
                {data.permissions.canManage ? <MenuItem danger icon={<Trash2 size={14} />} onClick={async () => { close(); await deleteBoard(); }}>Delete board</MenuItem> : null}
              </>
            )}
          </Menu>
        </div>
      </div>

      <div className="board-toolbar">
        <div className="board-search">
          <Search size={14} aria-hidden />
          <input className="input" placeholder="Filter this board…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Filter this board" />
        </div>
        <select className="select" style={{ width: 132, minHeight: 34, fontSize: 12 }} value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="Filter by priority">
          <option value="all">All priorities</option>
          {["urgent", "high", "medium", "low", "none"].map((value) => <option key={value} value={value}>{priorityLabel(value)}</option>)}
        </select>
        <select className="select" style={{ width: 142, minHeight: 34, fontSize: 12 }} value={assignee} onChange={(event) => setAssignee(event.target.value)} aria-label="Filter by assignee">
          <option value="all">Everyone</option>
          <option value="mine">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
        {activeFilters ? (
          <button type="button" className="btn ghost sm" onClick={() => { setQuery(""); setPriority("all"); setAssignee("all"); }}>
            <X size={12} aria-hidden /> Clear
          </button>
        ) : null}
        <span className="board-toolbar-spacer" />
        <span className="task-foot-meta" aria-live="polite">
          {draggingId ? "Drop to move" : activeFilters ? `${filtered.length} of ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}` : `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
        </span>
        {data.permissions.canEdit ? (
          <Menu trigger={<Plus size={15} />} triggerLabel="Add column" triggerClassName="icon-btn">
            {(close) => (
              <>
                <MenuItem icon={<Plus size={14} />} onClick={() => { close(); setColumnEditor({ mode: "new" }); }}>Add column</MenuItem>
                {columns.map((column) => <MenuItem key={column.id} icon={<Pencil size={13} />} onClick={() => { close(); setColumnEditor({ mode: "edit", column }); }}>Edit {column.name}</MenuItem>)}
              </>
            )}
          </Menu>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">{announcement}</p>

      {filtered.length === 0 && activeFilters ? (
        <EmptyState icon={<Filter size={20} />} title="No tasks match those filters" description="Try a shorter search, a different person, or clear the filters." action={<button type="button" className="btn" onClick={() => { setQuery(""); setPriority("all"); setAssignee("all"); }}>Clear filters</button>} />
      ) : mode === "board" ? (
        <div className="board-canvas" role="region" aria-label={`${data.board.name} board`}>
          {columns.map((column) => {
            const list = grouped.get(column.id) ?? [];
            const open = list.filter((task) => !task.completedAt).length;
            const wipOver = Boolean(column.wipEnforced && column.wipLimit && open > column.wipLimit);
            const wipNear = Boolean(column.wipEnforced && column.wipLimit && open === column.wipLimit);
            return (
              <section
                key={column.id}
                className={`column${dropColumn === column.id ? " drag-over" : ""}${wipOver || wipNear ? " wip-near" : ""}`}
                aria-label={`${column.name}, ${list.length} ${list.length === 1 ? "task" : "tasks"}`}
                {...dropHandlers(column.id)}
              >
                <div className="column-head">
                  <span className={`column-dot${column.isDone ? " done" : ""}`} aria-hidden />
                  <h2 className="column-title">
                    {column.name}
                    <span className="column-count">{open}</span>
                    {column.wipEnforced && column.wipLimit ? <span className={`wip-label${wipOver ? " rose" : ""}`}>WIP {open}/{column.wipLimit}</span> : null}
                  </h2>
                  <div className="column-head-actions">
                    <button type="button" className="icon-btn sm" aria-label={`Add task to ${column.name}`} onClick={() => setAddingColumn(column.id)}>
                      <Plus size={14} />
                    </button>
                    {data.permissions.canEdit ? (
                      <Menu trigger={<MoreHorizontal size={14} />} triggerLabel={`${column.name} actions`} triggerClassName="icon-btn sm">
                        {(close) => (
                          <>
                            <MenuItem icon={<Pencil size={13} />} onClick={() => { close(); setColumnEditor({ mode: "edit", column }); }}>Column settings</MenuItem>
                            <MenuItem icon={<ArrowRightLeft size={13} />} onClick={() => { close(); setColumnEditor({ mode: "edit", column }); }}>WIP limit</MenuItem>
                            <div className="menu-sep" />
                            <MenuItem danger icon={<Trash2 size={13} />} onClick={async () => { close(); await deleteColumn(column); }}>Delete column</MenuItem>
                          </>
                        )}
                      </Menu>
                    ) : null}
                  </div>
                </div>
                <div className="column-tasks">
                  {addingColumn === column.id ? (
                    <ColumnComposer workspaceId={workspace.id} boardId={data.board.id} columnId={column.id} timeZone={timeZone} onClose={() => setAddingColumn(null)} onCreated={async () => { setAddingColumn(null); await loadBoard(true); onChanged(); }} />
                  ) : null}
                  {list.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      dragging={draggingId === task.id}
                      onOpen={onOpenTask}
                      onDragStart={(dragged) => setDraggingId(dragged.id)}
                      onDragEnd={() => { setDraggingId(null); setDropColumn(null); }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => void dropOnCard(event, task)}
                      onKeyDown={(dragged, event) => void keyboardMove(dragged, event)}
                    />
                  ))}
                  {addingColumn !== column.id ? (
                    <button type="button" className="column-add" onClick={() => setAddingColumn(column.id)}>
                      <Plus size={13} aria-hidden /> Add a task
                    </button>
                  ) : null}
                </div>
              </section>
            );
          })}
          {data.permissions.canEdit ? (
            <button type="button" className="column" style={{ justifyContent: "flex-start", padding: 14, background: "transparent", borderStyle: "dashed", color: "var(--muted)", minHeight: 90 }} onClick={() => setColumnEditor({ mode: "new" })}>
              <span className="inline"><Plus size={15} /> Add column</span>
            </button>
          ) : null}
        </div>
      ) : (
        <div className="list-view">
          <div className="list-header" aria-hidden>
            <span />
            <span>Task</span>
            <span>Status</span>
            <span>Due</span>
            <span>Priority</span>
          </div>
          {filtered.map((task) => {
            const column = columns.find((item) => item.id === task.columnId);
            return (
              <button type="button" className="list-row" key={task.id} onClick={() => onOpenTask(task.id)}>
                <span className={`column-dot${task.completedAt ? " done" : ""}`} aria-hidden />
                <span className="row-title">
                  <span>{task.title}</span>
                  {(task.labels ?? []).slice(0, 2).map((label) => <LabelChip key={label.id} label={label} />)}
                </span>
                <span className="row-dim row-col-status">{column?.name ?? "—"}</span>
                <span className={`row-dim row-due${isOverdue(task.dueDate, task.completedAt) ? " field-error" : ""}`}>{task.dueDate ? formatDue(task.dueDate, task.dueAllDay) : "No date"}</span>
                <span><PriorityBadge priority={task.priority} compact /></span>
              </button>
            );
          })}
          {filtered.length === 0 ? <EmptyState title="Nothing on this board yet" description="Capture the first small step. You can organize it later." action={<button type="button" className="btn primary" onClick={onQuickCapture}><Sparkles size={14} /> Add the first task</button>} /> : null}
        </div>
      )}

      <ColumnDialog
        open={Boolean(columnEditor)}
        onClose={() => setColumnEditor(null)}
        mode={columnEditor?.mode ?? "new"}
        column={columnEditor?.column}
        workspaceId={workspace.id}
        boardId={data.board.id}
        onSaved={async () => { setColumnEditor(null); await loadBoard(true); onChanged(); }}
      />

      <BoardSettingsDialog
        open={boardSettingsOpen}
        onClose={() => setBoardSettingsOpen(false)}
        data={data}
        workspace={workspace}
        onSaved={async () => { setBoardSettingsOpen(false); await loadBoard(true); onChanged(); }}
      />
    </>
  );

  async function toggleShare() {
    try {
      const enabled = !data!.board.shareEnabled;
      const result = await api<{ enabled: boolean; url: string | null }>(`/api/boards/${data!.board.id}/share`, { method: "POST", workspaceId: workspace.id, body: { enabled }, idempotencyKey: newIdempotencyKey("share") });
      setData((current) => current ? { ...current, board: { ...current.board, shareEnabled: result.enabled } } : current);
      if (result.url) {
        await navigator.clipboard?.writeText(result.url).catch(() => undefined);
        toast.success("Read-only link copied to clipboard.");
      } else {
        toast.success("Public link disabled.");
      }
      onChanged();
    } catch (shareError) {
      toast.error(formatApiError(shareError));
    }
  }

  async function archiveBoard() {
    try {
      await api(`/api/boards/${data!.board.id}`, { method: "PATCH", workspaceId: workspace.id, body: { archived: true, version: data!.board.version } });
      toast.success("Board archived. You can restore it from Archive.");
      onChanged();
      const next = workspace.boards.find((board) => board.id !== data!.board.id);
      if (next) onOpenBoard(next.id);
    } catch (archiveError) {
      toast.error(formatApiError(archiveError));
    }
  }

  async function deleteBoard() {
    if (!window.confirm(`Delete “${data!.board.name}”? Tasks stay recoverable in the audit log and undo window.`)) return;
    try {
      const result = await api<{ undo?: { id?: string } }>(`/api/boards/${data!.board.id}`, { method: "DELETE", workspaceId: workspace.id });
      toast.push({ message: "Board deleted.", actionLabel: result.undo?.id ? "Undo" : undefined, onAction: result.undo?.id ? async () => { await api(`/api/undo/${result.undo!.id}`, { method: "POST", workspaceId: workspace.id, body: {} }); onChanged(); } : undefined });
      onChanged();
      const next = workspace.boards.find((board) => board.id !== data!.board.id);
      if (next) onOpenBoard(next.id);
    } catch (deleteError) {
      toast.error(formatApiError(deleteError));
    }
  }

  async function deleteColumn(column: BoardColumn) {
    if (!window.confirm(`Delete the “${column.name}” column? It must be empty.`)) return;
    try {
      await api(`/api/columns/${column.id}`, { method: "DELETE", workspaceId: workspace.id });
      toast.success("Column deleted.");
      await loadBoard(true);
      onChanged();
    } catch (deleteError) {
      toast.error(formatApiError(deleteError));
    }
  }
}

function ColumnComposer({ workspaceId, boardId, columnId, timeZone, onClose, onCreated }: {
  workspaceId: string;
  boardId: string;
  columnId: string;
  timeZone: string;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const parsed = useMemo(() => parseQuickAdd(value, new Date(), timeZone), [value, timeZone]);

  async function submit() {
    if (!value.trim() || saving) return;
    setSaving(true);
    try {
      await api("/api/tasks", {
        method: "POST",
        workspaceId,
        idempotencyKey: newIdempotencyKey("inline"),
        body: { workspaceId, boardId, columnId, title: parsed.title || value.trim(), priority: parsed.priority, labels: parsed.labels, dueDate: parsed.dueDate ?? null, dueAllDay: parsed.dueAllDay, estimateMinutes: parsed.estimateMinutes ?? null, recurrenceRule: parsed.recurrenceRule ?? null },
      });
      setValue("");
      await onCreated();
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="quick-composer">
      <textarea ref={ref} value={value} onChange={(event) => setValue(event.target.value)} placeholder="A small next step…" aria-label="New task title" onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void submit(); }
      }} />
      <div className="quick-composer-foot">
        <span className="quick-hint">{parsed.dueDate ? formatDue(parsed.dueDate, parsed.dueAllDay) : "↵ to add · Esc to close"}</span>
        <button type="button" className="btn ghost sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary sm" onClick={() => void submit()} disabled={!value.trim() || saving}>{saving ? "Adding…" : "Add"}</button>
      </div>
    </div>
  );
}

function ColumnDialog({ open, onClose, mode, column, workspaceId, boardId, onSaved }: {
  open: boolean;
  onClose: () => void;
  mode: "new" | "edit";
  column?: BoardColumn;
  workspaceId: string;
  boardId: string;
  onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [name, setName] = useState(column?.name ?? "");
  const [wip, setWip] = useState(column?.wipLimit ? String(column.wipLimit) : "");
  const [enforced, setEnforced] = useState(Boolean(column?.wipEnforced));
  const [isDone, setIsDone] = useState(Boolean(column?.isDone));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(column?.name ?? "");
    setWip(column?.wipLimit ? String(column.wipLimit) : "");
    setEnforced(Boolean(column?.wipEnforced));
    setIsDone(Boolean(column?.isDone));
  }, [column, open]);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const body = {
        ...(mode === "new" ? { boardId, name: name.trim() } : { name: name.trim(), wipLimit: wip ? Number(wip) : null, wipEnforced: enforced, isDone }),
      };
      if (mode === "new") await api("/api/columns", { method: "POST", workspaceId, body });
      else await api(`/api/columns/${column!.id}`, { method: "PATCH", workspaceId, body });
      toast.success(mode === "new" ? "Column added." : "Column updated.");
      await onSaved();
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={mode === "new" ? "Add a column" : "Column settings"} eyebrow="Board structure" width={420}
      footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><LoadingButton loading={saving} onClick={() => void save()}>{mode === "new" ? "Add column" : "Save"}</LoadingButton></>}>
      <div className="form-grid">
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="e.g. Waiting on" /></label>
        {mode === "edit" ? (
          <>
            <div className="form-grid two">
              <label className="field"><span>WIP limit</span><input className="input" type="number" min={1} max={999} value={wip} onChange={(event) => setWip(event.target.value)} placeholder="No limit" /></label>
              <label className="checkbox" style={{ alignSelf: "end" }}><input type="checkbox" checked={enforced} onChange={(event) => setEnforced(event.target.checked)} /> Enforce limit</label>
            </div>
            <label className="checkbox"><input type="checkbox" checked={isDone} onChange={(event) => setIsDone(event.target.checked)} /> Tasks here count as done</label>
            <p className="field-hint">Done columns complete tasks automatically. At least one done column must remain.</p>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function BoardSettingsDialog({ open, onClose, data, workspace, onSaved }: { open: boolean; onClose: () => void; data: BoardPayload; workspace: Workspace; onSaved: () => Promise<void> | void }) {
  const toast = useToast();
  const [name, setName] = useState(data.board.name);
  const [description, setDescription] = useState(data.board.description);
  const [visibility, setVisibility] = useState(data.board.visibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(data.board.name);
    setDescription(data.board.description);
    setVisibility(data.board.visibility);
    setError("");
  }, [data, open]);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/boards/${data.board.id}`, { method: "PATCH", workspaceId: workspace.id, body: { name: name.trim(), description, visibility, version: data.board.version } });
      toast.success("Board updated.");
      await onSaved();
    } catch (saveError) {
      setError(formatApiError(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Board settings" eyebrow={workspace.name} width={520}
      footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><LoadingButton loading={saving} onClick={() => void save()}>Save changes</LoadingButton></>}>
      <div className="form-grid">
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
        <label className="field"><span>Description</span><textarea className="textarea" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={3} /></label>
        <label className="field"><span>Who can see this board?</span>
          <select className="select" value={visibility} onChange={(event) => setVisibility(event.target.value)}>
            <option value="workspace">Everyone in {workspace.name}</option>
            <option value="private">Only me and workspace admins</option>
          </select>
        </label>
        {error ? <InlineError>{error}</InlineError> : null}
        <div className="card card-pad" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Users size={16} aria-hidden style={{ color: "var(--muted)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{workspace.memberCount} workspace member{workspace.memberCount === 1 ? "" : "s"}</div>
            <div className="field-hint">Visibility changes are logged in the workspace audit trail.</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
