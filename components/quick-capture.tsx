"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CornerDownLeft, Hash, Repeat2, Sparkles, Timer, Zap } from "lucide-react";
import { Modal } from "@/components/ui";
import { ApiClientError, api, newIdempotencyKey } from "@/lib/client";
import { enqueueWrite } from "@/lib/offline";
import { useToast } from "@/components/toast";
import { parseQuickAdd } from "@/lib/nlq";
import { formatDue, priorityLabel } from "@/lib/format";
import type { BoardSummary, Task, Workspace } from "@/lib/types";

type Props = {
  open: boolean;
  workspace: Workspace;
  timeZone: string;
  defaultBoardId?: string | null;
  onClose: () => void;
  onCreated: (task: Task, boardId: string) => void | Promise<void>;
};

export function QuickCapture({ open, workspace, timeZone, defaultBoardId, onClose, onCreated }: Props) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [boardId, setBoardId] = useState(defaultBoardId ?? workspace.boards[0]?.id ?? "");
  const [columnId, setColumnId] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const board = useMemo<BoardSummary | undefined>(
    () => workspace.boards.find((item) => item.id === boardId) ?? workspace.boards[0],
    [boardId, workspace.boards],
  );
  const columns = board?.columns ?? [];
  const parsed = useMemo(() => parseQuickAdd(text, new Date(), timeZone), [text, timeZone]);

  useEffect(() => {
    if (!open) return;
    setBoardId(defaultBoardId && workspace.boards.some((item) => item.id === defaultBoardId) ? defaultBoardId : workspace.boards[0]?.id ?? "");
    setText("");
    const timer = setTimeout(() => textareaRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open, defaultBoardId, workspace.boards]);

  useEffect(() => {
    const nextColumns = workspace.boards.find((item) => item.id === boardId)?.columns ?? [];
    setColumnId((current) => (nextColumns.some((column) => column.id === current) ? current : nextColumns[0]?.id ?? ""));
  }, [boardId, workspace.boards]);

  async function submit() {
    if (!text.trim() || !board || !columnId || saving) return;
    setSaving(true);
    const draft = {
      workspaceId: workspace.id,
      boardId: board.id,
      columnId,
      title: parsed.title || text.trim(),
      priority: parsed.priority,
      labels: parsed.labels,
      dueDate: parsed.dueDate ?? null,
      dueAllDay: parsed.dueAllDay,
      estimateMinutes: parsed.estimateMinutes ?? null,
      recurrenceRule: parsed.recurrenceRule ?? null,
    };
    const idempotencyKey = newIdempotencyKey("capture");
    const queuedOffline = () => {
      enqueueWrite({
        kind: "task.create",
        label: draft.title,
        path: "/api/tasks",
        method: "POST",
        body: draft,
        workspaceId: workspace.id,
        idempotencyKey,
      });
      toast.push({
        message: `Saved on this device — “${draft.title}” will sync when you reconnect.`,
        duration: 5000,
      });
      setText("");
      onClose();
    };
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      queuedOffline();
      setSaving(false);
      return;
    }
    try {
      const result = await api<{ task: Task; undo?: { id: string } }>("/api/tasks", {
        method: "POST",
        workspaceId: workspace.id,
        idempotencyKey,
        body: draft,
      });
      toast.push({
        message: `Added to ${board.name}`,
        tone: "success",
        actionLabel: "Undo",
        onAction: async () => {
          if (!result.undo?.id) return;
          await api(`/api/undo/${result.undo.id}`, { method: "POST", workspaceId: workspace.id, body: {} });
          await onCreated({ ...result.task, id: "" }, board.id);
        },
      });
      await onCreated(result.task, board.id);
      setText("");
      onClose();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "NETWORK_ERROR") {
        queuedOffline();
        return;
      }
      toast.error(error instanceof Error ? error.message : "Could not add that task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="capture-dialog" eyebrow="Quick capture" width={620}>
      <textarea
        ref={textareaRef}
        className="capture-input"
        aria-label="What needs doing?"
        placeholder="What needs doing? Try “Draft launch note tomorrow 2pm !high #Work ~45m”"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        rows={3}
      />
      <div className="capture-preview" aria-live="polite">
        {parsed.title && text.trim() ? <span className="badge accent">New task</span> : null}
        {parsed.dueDate ? (
          <span className="badge blue">
            <CalendarDays size={11} aria-hidden /> {formatDue(parsed.dueDate, parsed.dueAllDay)}
          </span>
        ) : null}
        {parsed.priority !== "none" ? <span className="badge rose">{priorityLabel(parsed.priority)}</span> : null}
        {parsed.labels.map((label) => (
          <span className="badge moss" key={label}>
            <Hash size={10} aria-hidden /> {label}
          </span>
        ))}
        {parsed.estimateMinutes ? (
          <span className="badge slate">
            <Timer size={11} aria-hidden /> {parsed.estimateMinutes}m
          </span>
        ) : null}
        {parsed.recurrenceRule ? (
          <span className="badge violet">
            <Repeat2 size={11} aria-hidden /> Repeats
          </span>
        ) : null}
        {!text.trim() ? (
          <span className="capture-meta">
            <Sparkles size={11} aria-hidden /> Plain language works — Drift parses dates, labels and priorities locally.
          </span>
        ) : null}
      </div>
      <div className="capture-options">
        <label className="field" style={{ flex: 1, minWidth: 150 }}>
          <span className="label">Board</span>
          <select className="select" value={board?.id ?? ""} onChange={(event) => setBoardId(event.target.value)} aria-label="Board">
            {workspace.boards.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: 1, minWidth: 140 }}>
          <span className="label">Column</span>
          <select className="select" value={columnId} onChange={(event) => setColumnId(event.target.value)} aria-label="Column">
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn primary" onClick={() => void submit()} disabled={!text.trim() || !columnId || saving}>
          <Zap size={14} aria-hidden />
          {saving ? "Adding…" : "Add task"}
          <span className="kbd" style={{ marginLeft: 3, background: "transparent", color: "inherit", borderColor: "currentColor", opacity: 0.7 }}>
            <CornerDownLeft size={9} aria-hidden />
          </span>
        </button>
      </div>
      <p className="capture-tip" style={{ marginBottom: 0 }}>
        Keep it small. You can add details, checklists and people later — or press Esc and come back.
      </p>
    </Modal>
  );
}
