"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CalendarDays,
  Check,
  CheckSquare,
  Circle,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Repeat2,
  RotateCcw,
  Trash2,
  User2,
  X,
} from "lucide-react";
import { Avatar, InlineError, Menu, MenuItem, Modal, PriorityBadge, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, ApiClientError, formatApiError, newIdempotencyKey } from "@/lib/client";
import { describeRecurrence } from "@/lib/recurrence";
import {
  dueToIso,
  formatDate,
  formatDue,
  humanFileSize,
  isoToDateInput,
  isoToTimeInput,
  memberName,
  relativeTime,
} from "@/lib/format";
import type { BoardPayload, Comment, Subtask, Task, TaskDetail, Workspace } from "@/lib/types";

const REMINDERS = [
  { value: "", label: "No reminder" },
  { value: "0", label: "At due time" },
  { value: "10", label: "10 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

const RECURRENCES = [
  { value: "", label: "Does not repeat" },
  { value: "FREQ=DAILY;INTERVAL=1", label: "Every day" },
  { value: "FREQ=WEEKLY;INTERVAL=1", label: "Every week" },
  { value: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR", label: "Every weekday" },
  { value: "FREQ=MONTHLY;INTERVAL=1", label: "Every month" },
];

type Props = {
  taskId: string | null;
  workspace: Workspace;
  onClose: () => void;
  onChanged: () => void;
  onOpenTask: (taskId: string) => void;
};

export function TaskDrawer({ taskId, workspace, onClose, onChanged, onOpenTask }: Props) {
  const toast = useToast();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const [comment, setComment] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [dependencyToAdd, setDependencyToAdd] = useState("");
  const [uploading, setUploading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError("");
    setConflict(false);
    try {
      const payload = await api<TaskDetail>(`/api/tasks/${taskId}?workspaceId=${encodeURIComponent(workspace.id)}`, { workspaceId: workspace.id });
      setDetail(payload);
      setTitle(payload.task.title);
      setDescription(payload.task.description);
      setLabelsText(payload.task.labels.map((label) => label.name).join(", "));
      const boardPayload = await api<BoardPayload>(`/api/boards/${payload.task.boardId}`, { workspaceId: workspace.id }).catch(() => null);
      setBoard(boardPayload);
    } catch (loadError) {
      setError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }, [taskId, workspace.id]);

  useEffect(() => {
    setDetail(null);
    setBoard(null);
    void load();
  }, [load]);

  useEffect(() => {
    return () => { if (savedTimer.current) clearTimeout(savedTimer.current); };
  }, []);

  const task = detail?.task;
  const columns = board?.board.columns ?? (task ? [{ id: task.columnId, name: task.column?.name ?? "Column", isDone: task.column?.isDone ?? false }] : []);
  const members = detail?.members ?? [];
  const reminderValue = useMemo(() => {
    if (!task?.reminders?.length || !task.dueDate) return "";
    const offset = Math.max(0, Math.round((new Date(task.dueDate).getTime() - new Date(task.reminders[0]!.remindAt).getTime()) / 60_000));
    return REMINDERS.some((item) => item.value === String(offset)) ? String(offset) : "";
  }, [task]);
  const recurrenceValue = RECURRENCES.some((item) => item.value === task?.recurrenceRule) ? task?.recurrenceRule ?? "" : task?.recurrenceRule ?? "";

  function flashSaved() {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1600);
  }

  async function patch(input: Record<string, unknown>, options: { quiet?: boolean; success?: string } = {}) {
    if (!task || saving) return false;
    setSaving(true);
    setConflict(false);
    try {
      const result = await api<{ task: Task; nextTaskId?: string }>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        workspaceId: workspace.id,
        idempotencyKey: newIdempotencyKey("task-update"),
        body: { ...input, version: task.version },
      });
      setDetail((current) => current ? { ...current, task: { ...result.task, comments: result.task.comments ?? current.task.comments, attachments: result.task.attachments ?? current.task.attachments } } : current);
      setTitle(result.task.title);
      setDescription(result.task.description);
      setLabelsText(result.task.labels.map((label) => label.name).join(", "));
      flashSaved();
      onChanged();
      if (options.success) toast.success(options.success);
      if (result.nextTaskId) toast.push({ message: "A repeating task was scheduled next.", tone: "success" });
      return true;
    } catch (saveError) {
      if (saveError instanceof ApiClientError && saveError.code === "VERSION_CONFLICT") {
        setConflict(true);
        setError("Someone changed this task while you were editing. Reload to see the newer version.");
      } else {
        toast.error(formatApiError(saveError));
      }
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggleComplete() {
    if (!task) return;
    const next = !task.completedAt;
    const ok = await patch({ completed: next }, { success: next ? "Task completed." : "Task reopened." });
    if (!ok && next) setError("Could not complete this task. Check dependencies or WIP limits.");
  }

  async function addComment() {
    if (!task || !comment.trim()) return;
    try {
      const result = await api<{ comment: Comment }>(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        workspaceId: workspace.id,
        body: { body: comment.trim() },
        idempotencyKey: newIdempotencyKey("comment"),
      });
      setDetail((current) => current ? { ...current, task: { ...current.task, comments: [...(current.task.comments ?? []), result.comment] } } : current);
      setComment("");
    } catch (commentError) {
      toast.error(formatApiError(commentError));
    }
  }

  async function addSubtask() {
    if (!task || !subtaskTitle.trim()) return;
    try {
      const result = await api<{ subtask: Subtask }>(`/api/tasks/${task.id}/subtasks`, {
        method: "POST",
        workspaceId: workspace.id,
        body: { title: subtaskTitle.trim() },
        idempotencyKey: newIdempotencyKey("subtask"),
      });
      setDetail((current) => current ? { ...current, task: { ...current.task, subtasks: [...current.task.subtasks, result.subtask] } } : current);
      setSubtaskTitle("");
      onChanged();
    } catch (subtaskError) {
      toast.error(formatApiError(subtaskError));
    }
  }

  async function toggleSubtask(subtask: Subtask) {
    if (!task) return;
    try {
      const result = await api<{ subtask: Subtask }>(`/api/subtasks/${subtask.id}`, {
        method: "PATCH",
        workspaceId: workspace.id,
        body: { completed: !subtask.completed },
      });
      setDetail((current) => current ? { ...current, task: { ...current.task, subtasks: current.task.subtasks.map((item) => item.id === subtask.id ? result.subtask : item) } } : current);
      onChanged();
    } catch (subtaskError) {
      toast.error(formatApiError(subtaskError));
    }
  }

  async function deleteSubtask(subtask: Subtask) {
    try {
      await api(`/api/subtasks/${subtask.id}`, { method: "DELETE", workspaceId: workspace.id });
      setDetail((current) => current ? { ...current, task: { ...current.task, subtasks: current.task.subtasks.filter((item) => item.id !== subtask.id) } } : current);
      onChanged();
    } catch (subtaskError) {
      toast.error(formatApiError(subtaskError));
    }
  }

  async function deleteTask() {
    if (!task || !window.confirm(`Delete “${task.title}”? You can undo for a few seconds.`)) return;
    try {
      const result = await api<{ undo?: { id?: string } }>(`/api/tasks/${task.id}`, { method: "DELETE", workspaceId: workspace.id });
      onChanged();
      onClose();
      toast.push({
        message: "Task deleted.",
        actionLabel: result.undo?.id ? "Undo" : undefined,
        onAction: result.undo?.id ? async () => {
          await api(`/api/undo/${result.undo!.id}`, { method: "POST", workspaceId: workspace.id, body: {} });
          onChanged();
        } : undefined,
      });
    } catch (deleteError) {
      toast.error(formatApiError(deleteError));
    }
  }

  async function undoAutomationRun(undoId: string) {
    try {
      await api(`/api/undo/${undoId}`, { method: "POST", workspaceId: workspace.id, body: {} });
      toast.success("Automation change undone.");
      await load();
      onChanged();
    } catch (undoError) {
      toast.error(formatApiError(undoError));
    }
  }

  async function archiveTask() {
    if (!task) return;
    const ok = await patch({ archived: true }, { success: "Task archived." });
    if (ok) onClose();
  }

  async function uploadFiles(files: FileList | null) {
    if (!task || !files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 5)) {
        const form = new FormData();
        form.set("taskId", task.id);
        form.set("workspaceId", workspace.id);
        form.set("file", file);
        const response = await fetch("/api/attachments", { method: "POST", body: form, credentials: "same-origin" });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message ?? "Upload failed.");
        setDetail((current) => current ? { ...current, task: { ...current.task, attachments: [payload.attachment, ...(current.task.attachments ?? [])] } } : current);
      }
      toast.success("Attachment uploaded.");
      onChanged();
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const dependencyOptions = (board?.tasks ?? []).filter((candidate) => candidate.id !== task?.id && !(task?.dependencyIds ?? []).includes(candidate.id));
  const checklistDone = task?.subtasks.filter((item) => item.completed).length ?? 0;

  return (
    <Modal
      open={Boolean(taskId)}
      onClose={onClose}
      drawer
      eyebrow={task ? <><span>{task.board?.name ?? "Task"}</span><span aria-hidden> · </span><span>{task.column?.name ?? ""}</span></> : "Task"}
      title={
        <span className="inline" style={{ gap: 6 }}>
          {task ? <><PriorityBadge priority={task.priority} compact /> {task.completedAt ? <span className="badge accent">Done</span> : null}</> : null}
          <span className="sr-only">{task?.title ?? "Task details"}</span>
        </span>
      }
      footer={
        task ? (
          <>
            <button type="button" className="btn ghost" onClick={onClose}>Close</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn ghost sm" onClick={async () => { await navigator.clipboard?.writeText(`${window.location.origin}/?task=${task.id}`); toast.success("Link copied."); }}><Copy size={12} /> Link</button>
            <button type="button" className="btn ghost sm" onClick={() => void archiveTask()}><Archive size={12} /> Archive</button>
            <Menu trigger={<MoreHorizontal size={16} />} triggerLabel="More task actions">
              {(close) => (
                <>
                  <MenuItem icon={<ExternalLink size={13} />} onClick={() => { close(); onClose(); }}>Close panel</MenuItem>
                  <MenuItem icon={<RotateCcw size={13} />} onClick={() => { close(); void load(); }}>Reload latest</MenuItem>
                  <div className="menu-sep" />
                  <MenuItem danger icon={<Trash2 size={13} />} onClick={() => { close(); void deleteTask(); }}>Delete task</MenuItem>
                </>
              )}
            </Menu>
          </>
        ) : <button type="button" className="btn" onClick={onClose}>Close</button>
      }
    >
      {loading && !task ? <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner label="Opening task" /></div> : null}
      {error && !task ? <InlineError>{error}</InlineError> : null}
      {task ? (
        <>
          {conflict ? (
            <div className="auth-guest-banner" role="alert" style={{ marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <strong style={{ display: "block", marginBottom: 2 }}>A newer version exists</strong>
                {error || "Reload before editing so you don't overwrite someone else's work."}
              </div>
              <button type="button" className="btn sm" onClick={() => void load()}>Reload</button>
            </div>
          ) : null}
          {saving ? <div className="field-hint" role="status"><Loader2 size={11} className="spin" /> Saving…</div> : saved ? <div className="field-hint" role="status"><Check size={11} /> Saved</div> : null}

          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <button type="button" className="icon-btn" aria-label={task.completedAt ? "Reopen task" : "Complete task"} onClick={() => void toggleComplete()} style={{ marginTop: 2 }}>
              {task.completedAt ? <CheckSquare size={20} style={{ color: "var(--accent)" }} /> : <Circle size={20} />}
            </button>
            <textarea
              className="task-detail-title"
              value={title}
              rows={2}
              aria-label="Task title"
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => { if (title.trim() && title.trim() !== task.title) void patch({ title: title.trim() }); else if (!title.trim()) setTitle(task.title); }}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); (event.target as HTMLTextAreaElement).blur(); } }}
            />
          </div>

          <div className="drawer-meta-row">
            <span className={`badge ${task.completedAt ? "accent" : "slate"}`}>{task.completedAt ? `Completed ${formatDate(task.completedAt)}` : "Open"}</span>
            {task.dueDate ? <span className={`badge ${new Date(task.dueDate) < new Date() && !task.completedAt ? "rose" : "slate"}`}><CalendarDays size={10} /> {formatDue(task.dueDate, task.dueAllDay)}</span> : null}
            {task.recurrenceRule ? <span className="badge violet"><Repeat2 size={10} /> {describeRecurrence(task.recurrenceRule)}</span> : null}
            {task.openDependencies ? <span className="badge amber"><Link2 size={10} /> {task.openDependencies} waiting</span> : null}
            <span className="field-hint" style={{ marginLeft: "auto" }}>v{task.version}</span>
          </div>

          <div className="property-grid" style={{ marginTop: 18 }}>
            <div className="property-label"><Circle size={13} /> Status</div>
            <div className="property-value">
              <select className="select" aria-label="Status" value={task.columnId} disabled={saving}
                onChange={(event) => {
                  const columnId = event.target.value;
                  if (columnId === task.columnId) return;
                  api<{ task: Task }>(`/api/tasks/${task.id}/move`, { method: "PATCH", workspaceId: workspace.id, body: { columnId, version: task.version } })
                    .then((result) => { setDetail((current) => current ? { ...current, task: result.task } : current); onChanged(); flashSaved(); })
                    .catch((moveError) => { toast.error(formatApiError(moveError)); void load(); });
                }}>
                {columns.map((column) => <option key={column.id} value={column.id}>{column.name}{column.isDone ? " · done" : ""}</option>)}
              </select>
            </div>

            <div className="property-label"><User2 size={13} /> Assignee</div>
            <div className="property-value">
              <select className="select" aria-label="Assignee" value={task.assignee?.id ?? ""} disabled={saving} onChange={(event) => void patch({ assigneeId: event.target.value || null })}>
                <option value="">Unassigned</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </div>

            <div className="property-label"><CalendarDays size={13} /> Due</div>
            <div className="property-value inline" style={{ gap: 6 }}>
              <input className="input" type="date" aria-label="Due date" value={isoToDateInput(task.dueDate)} disabled={saving}
                onChange={(event) => {
                  const value = event.target.value;
                  void patch({ dueDate: value ? dueToIso(value, isoToTimeInput(task.dueDate), task.dueAllDay) : null, dueAllDay: task.dueAllDay });
                }}
                style={{ flex: 1, minWidth: 120 }} />
              <input className="input" type="time" aria-label="Due time" value={task.dueAllDay ? "" : isoToTimeInput(task.dueDate)} disabled={saving || task.dueAllDay}
                onChange={(event) => {
                  if (!event.target.value) return;
                  void patch({ dueDate: dueToIso(isoToDateInput(task.dueDate), event.target.value, false), dueAllDay: false });
                }}
                style={{ width: 105 }} />
              <label className="checkbox" style={{ minWidth: 72 }}><input type="checkbox" checked={task.dueAllDay} disabled={saving} onChange={(event) => void patch({ dueAllDay: event.target.checked, dueDate: event.target.checked ? dueToIso(isoToDateInput(task.dueDate), isoToTimeInput(task.dueDate), true) : task.dueDate })} /> All day</label>
            </div>

            <div className="property-label"><Clock3 size={13} /> Estimate</div>
            <div className="property-value inline">
              <input className="input" type="number" min={0} max={1440} step={5} placeholder="Minutes" aria-label="Estimate in minutes" defaultValue={task.estimateMinutes ?? ""} disabled={saving}
                onBlur={(event) => {
                  const value = event.target.value ? Number(event.target.value) : null;
                  if (value !== task.estimateMinutes) void patch({ estimateMinutes: value });
                }} style={{ width: 110 }} />
              <span className="field-hint">minutes</span>
            </div>

            <div className="property-label">Priority</div>
            <div className="property-value">
              <select className="select" aria-label="Priority" value={task.priority} disabled={saving} onChange={(event) => void patch({ priority: event.target.value })}>
                {["none", "low", "medium", "high", "urgent"].map((value) => <option key={value} value={value}>{value === "none" ? "No priority" : value[0]!.toUpperCase() + value.slice(1)}</option>)}
              </select>
            </div>

            <div className="property-label">Labels</div>
            <div className="property-value">
              <input className="input" aria-label="Labels, comma separated" value={labelsText} disabled={saving} placeholder="Work, Personal" onChange={(event) => setLabelsText(event.target.value)}
                onBlur={() => { const names = labelsText.split(",").map((value) => value.trim()).filter(Boolean); if (names.join("|") !== task.labels.map((label) => label.name).join("|")) void patch({ labels: names }); }} />
            </div>

            <div className="property-label"><Repeat2 size={13} /> Repeats</div>
            <div className="property-value">
              <select className="select" aria-label="Recurrence" value={recurrenceValue} disabled={saving} onChange={(event) => void patch({ recurrenceRule: event.target.value || null })}>
                {RECURRENCES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                {recurrenceValue && !RECURRENCES.some((item) => item.value === recurrenceValue) ? <option value={recurrenceValue}>{describeRecurrence(recurrenceValue) ?? "Custom"}</option> : null}
              </select>
            </div>

            <div className="property-label">Reminder</div>
            <div className="property-value">
              <select className="select" aria-label="Reminder" value={reminderValue} disabled={saving || !task.dueDate} onChange={(event) => void patch({ reminderOffsetMinutes: event.target.value === "" ? null : Number(event.target.value) })}>
                {REMINDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
          </div>

          <section className="drawer-section">
            <div className="drawer-section-head"><h3>Notes</h3>{description !== task.description ? <button type="button" className="btn soft sm" disabled={saving} onClick={() => void patch({ description })}>Save notes</button> : null}</div>
            <textarea className="textarea description-editor" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Context, links, the smallest next step…" aria-label="Task description" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void patch({ description }); } }} />
          </section>

          <section className="drawer-section">
            <div className="drawer-section-head">
              <h3>Checklist {task.subtasks.length ? <span style={{ color: "var(--faint)" }}>· {checklistDone}/{task.subtasks.length}</span> : null}</h3>
              <div className="progress" style={{ width: 70 }}><span style={{ width: `${task.subtasks.length ? Math.round((checklistDone / task.subtasks.length) * 100) : 0}%` }} /></div>
            </div>
            <div className="checklist">
              {task.subtasks.map((item) => (
                <div className={`check-row${item.completed ? " completed" : ""}`} key={item.id}>
                  <input type="checkbox" checked={item.completed} onChange={() => void toggleSubtask(item)} aria-label={item.title} />
                  <span style={{ flex: 1 }}>{item.title}</span>
                  <button type="button" className="icon-btn sm" aria-label={`Remove ${item.title}`} onClick={() => void deleteSubtask(item)}><X size={12} /></button>
                </div>
              ))}
            </div>
            <div className="comment-compose" style={{ marginTop: 8 }}>
              <input className="input" value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="Add a checklist item" aria-label="New checklist item" onKeyDown={(event) => { if (event.key === "Enter") void addSubtask(); }} />
              <button type="button" className="btn sm" onClick={() => void addSubtask()} disabled={!subtaskTitle.trim()}><Plus size={12} /> Add</button>
            </div>
          </section>

          <section className="drawer-section">
            <div className="drawer-section-head"><h3><Link2 size={12} /> Waiting on</h3></div>
            {(task.dependencies ?? []).length ? (
              <div className="settings-card" style={{ boxShadow: "none" }}>
                {task.dependencies!.map((dependency) => (
                  <div className="member-row" key={dependency.id} style={{ padding: "8px 10px" }}>
                    <span className={`side-dot${dependency.completed ? "" : " over"}`} aria-hidden />
                    <div className="member-copy"><strong>{dependency.title}</strong><span>{dependency.completed ? "Done" : "Still open"}</span></div>
                    <button type="button" className="icon-btn sm" aria-label={`Remove dependency ${dependency.title}`} onClick={() => void patch({ dependencyIds: task.dependencies!.filter((item) => item.id !== dependency.id).map((item) => item.id) })}><X size={12} /></button>
                  </div>
                ))}
              </div>
            ) : <p className="field-hint" style={{ marginTop: 0 }}>No blockers. This task can move freely.</p>}
            <div className="comment-compose" style={{ marginTop: 8 }}>
              <select className="select" value={dependencyToAdd} onChange={(event) => setDependencyToAdd(event.target.value)} aria-label="Add a blocking task">
                <option value="">Choose a task to wait on…</option>
                {dependencyOptions.slice(0, 100).map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
              </select>
              <button type="button" className="btn sm" disabled={!dependencyToAdd || saving} onClick={async () => {
                const next = [...(task.dependencyIds ?? []), dependencyToAdd];
                const ok = await patch({ dependencyIds: next });
                if (ok) setDependencyToAdd("");
              }}><Plus size={12} /> Add</button>
            </div>
          </section>

          <section className="drawer-section">
            <div className="drawer-section-head"><h3><Paperclip size={12} /> Attachments</h3><button type="button" className="btn ghost sm" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? "Uploading…" : "Attach file"}</button></div>
            <input ref={fileRef} type="file" hidden multiple onChange={(event) => void uploadFiles(event.target.files)} aria-label="Upload attachments" />
            {(task.attachments ?? []).length ? (task.attachments ?? []).map((attachment) => (
              <div className="attachment-row" key={attachment.id}>
                <span className="file-mark"><FileText size={13} /></span>
                <span className="file-name">{attachment.name}</span>
                <span className="field-hint">{humanFileSize(attachment.size)}</span>
                <a className="icon-btn sm" href={`/api/attachments/${attachment.id}`} aria-label={`Download ${attachment.name}`}><Download size={13} /></a>
              </div>
            )) : <p className="field-hint" style={{ marginTop: 0 }}>PDF, image and plain-text files up to 10 MB. Scanner is not configured; only upload trusted files.</p>}
          </section>

          <section className="drawer-section">
            <div className="drawer-section-head"><h3><MessageSquare size={12} /> Comments</h3></div>
            <div className="comments">
              {(task.comments ?? []).map((entry) => (
                <div className="comment" key={entry.id}>
                  <Avatar name={entry.author?.name ?? "You"} src={entry.author?.avatarUrl} size="sm" />
                  <div className="comment-content">
                    <div className="comment-head"><strong>{entry.author?.name ?? "You"}</strong><span>{relativeTime(entry.createdAt)}</span></div>
                    <div className="comment-body">{entry.body}</div>
                  </div>
                </div>
              ))}
              {!(task.comments ?? []).length ? <p className="field-hint">No comments yet. Keep the thread near the work.</p> : null}
            </div>
            <div className="comment-compose">
              <textarea className="textarea" style={{ minHeight: 64 }} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add context, ask a question, or leave a note for later…" aria-label="New comment" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void addComment(); } }} />
              <button type="button" className="btn primary sm" style={{ alignSelf: "flex-end" }} onClick={() => void addComment()} disabled={!comment.trim()}>Send</button>
            </div>
          </section>

          <section className="drawer-section">
            <div className="drawer-section-head"><h3>Activity</h3></div>
            {(detail?.activity ?? []).slice(0, 12).map((entry) => (
              <div className="activity-item" key={entry.id}>
                <span className={`side-dot${entry.action.includes("completed") ? " today" : ""}`} aria-hidden />
                <div style={{ flex: 1 }}>
                  <strong>{entry.actor?.name ?? "Someone"}</strong> {entry.action === "automation.applied" ? "applied an automation" : entry.action.replace("task.", "").replace(/_/g, " ")}
                  <div>{relativeTime(entry.createdAt)}</div>
                </div>
                {entry.undoId ? <button type="button" className="btn ghost sm" onClick={() => void undoAutomationRun(entry.undoId!)}><RotateCcw size={12} /> Undo</button> : null}
              </div>
            ))}
            {!(detail?.activity ?? []).length ? <p className="field-hint">No activity recorded yet.</p> : null}
          </section>
        </>
      ) : null}
    </Modal>
  );
}
