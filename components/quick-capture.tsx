"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CornerDownLeft, Hash, Mic, MicOff, Repeat2, Sparkles, Timer, Zap } from "lucide-react";
import { Modal } from "@/components/ui";
import { ApiClientError, api, newIdempotencyKey } from "@/lib/client";
import { enqueueWrite } from "@/lib/offline";
import { useToast } from "@/components/toast";
import { parseQuickAdd } from "@/lib/nlq";
import { playSound } from "@/lib/sound";
import { useI18n } from "@/lib/i18n";
import { formatDue, priorityLabel } from "@/lib/format";
import type { BoardSummary, Task, Workspace } from "@/lib/types";

type SpeechResult = {
  isFinal: boolean;
  [index: number]: { transcript: string } | undefined;
};

type SpeechResultEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechResult | undefined;
  };
};

type SpeechErrorEvent = { error: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type Props = {
  open: boolean;
  workspace: Workspace;
  timeZone: string;
  defaultBoardId?: string | null;
  voiceEnabled?: boolean;
  closeAfterAdd?: boolean;
  onClose: () => void;
  onCreated: (task: Task, boardId: string) => void | Promise<void>;
};

export function QuickCapture({ open, workspace, timeZone, defaultBoardId, voiceEnabled = true, closeAfterAdd = true, onClose, onCreated }: Props) {
  const toast = useToast();
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [boardId, setBoardId] = useState(defaultBoardId ?? workspace.boards[0]?.id ?? "");
  const [columnId, setColumnId] = useState("");
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const board = useMemo<BoardSummary | undefined>(
    () => workspace.boards.find((item) => item.id === boardId) ?? workspace.boards[0],
    [boardId, workspace.boards],
  );
  const columns = board?.columns ?? [];
  const parsed = useMemo(() => parseQuickAdd(text, new Date(), timeZone), [text, timeZone]);

  useEffect(() => {
    const speechWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    setVoiceSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    if (!open) {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      setListening(false);
      setInterim("");
      return;
    }
    setBoardId(defaultBoardId && workspace.boards.some((item) => item.id === defaultBoardId) ? defaultBoardId : workspace.boards[0]?.id ?? "");
    setText("");
    setVoiceError("");
    setInterim("");
    const timer = setTimeout(() => textareaRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open, defaultBoardId, workspace.boards]);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
  }, []);

  function stopVoice() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setInterim("");
  }

  function toggleVoice() {
    if (listening) {
      stopVoice();
      return;
    }
    const speechWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setVoiceError(t("Voice input isn’t available in this browser. The text field is always here."));
      return;
    }
    setVoiceError("");
    setInterim("");
    const recognition = new Constructor();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        if (!result) continue;
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (finalText.trim()) {
        setText((current) => {
          const separator = current && !/\s$/.test(current) ? " " : "";
          return `${current}${separator}${finalText.trim()}`;
        });
      }
      setInterim(interimText.trim());
    };
    recognition.onerror = (event) => {
      const message =
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? t("Microphone permission was denied. You can still type the task.")
          : event.error === "no-speech"
            ? t("No speech detected. Try again, or type instead.")
            : t("Voice input stopped. You can type the task instead.");
      setVoiceError(message);
      setListening(false);
      setInterim("");
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
      recognitionRef.current = null;
      window.setTimeout(() => textareaRef.current?.focus(), 30);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setVoiceError(t("Voice input could not start. You can type the task instead."));
      recognitionRef.current = null;
    }
  }

  useEffect(() => {
    const nextColumns = workspace.boards.find((item) => item.id === boardId)?.columns ?? [];
    setColumnId((current) => (nextColumns.some((column) => column.id === current) ? current : nextColumns[0]?.id ?? ""));
  }, [boardId, workspace.boards]);

  async function submit() {
    if (!text.trim() || !board || !columnId || saving) return;
    if (listening) stopVoice();
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
      playSound("capture");
      if (closeAfterAdd) onClose();
      else window.setTimeout(() => textareaRef.current?.focus(), 30);
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
      playSound("capture");
      if (closeAfterAdd) onClose();
      else window.setTimeout(() => textareaRef.current?.focus(), 30);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "NETWORK_ERROR") {
        queuedOffline();
        return;
      }
      playSound("error");
      toast.error(error instanceof Error ? error.message : "Could not add that task.");
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if (listening) stopVoice();
    onClose();
  }

  return (
    <Modal open={open} onClose={close} className="capture-dialog" eyebrow={t("Quick capture")} width={620}>
      <textarea
        ref={textareaRef}
        className="capture-input"
        aria-label={t("What needs doing?")}
        placeholder={t("What needs doing? Try “Draft launch note tomorrow 2pm !high #Work ~45m”")}
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
      {voiceEnabled ? (
        <>
          <div className={`capture-voice${listening ? " listening" : ""}`}>
            <button
              type="button"
              className={`btn ghost sm${listening ? " listening" : ""}`}
              onClick={toggleVoice}
              aria-pressed={listening}
              aria-label={listening ? "Stop voice capture" : "Speak a task"}
              title={voiceSupported ? "Speak a task" : "Voice input isn’t available in this browser"}
            >
              {listening ? <MicOff size={13} aria-hidden /> : <Mic size={13} aria-hidden />}
              {listening ? t("Stop listening") : t("Speak")}
            </button>
            <span className="field-hint" aria-live="polite">
              {listening
                ? interim
                  ? `“${interim}”`
                  : t("Listening… speak now. You can edit the words before adding.")
                : voiceSupported
                  ? t("Uses your browser’s speech service. Edit the words before adding; typing always works too.")
                  : t("Voice isn’t available in this browser — type instead.")}
            </span>
            {interim && !listening ? <span className="badge accent">Heard</span> : null}
          </div>
          {voiceError ? <p className="field-error" role="alert">{voiceError}</p> : null}
        </>
      ) : null}
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
          <span className="label">{t("Board")}</span>
          <select className="select" value={board?.id ?? ""} onChange={(event) => setBoardId(event.target.value)} aria-label={t("Board")}>
            {workspace.boards.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: 1, minWidth: 140 }}>
          <span className="label">{t("Column")}</span>
          <select className="select" value={columnId} onChange={(event) => setColumnId(event.target.value)} aria-label={t("Column")}>
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn primary" onClick={() => void submit()} disabled={!text.trim() || !columnId || saving}>
          <Zap size={14} aria-hidden />
          {saving ? t("Adding…") : t("Add task")}
          <span className="kbd" style={{ marginLeft: 3, background: "transparent", color: "inherit", borderColor: "currentColor", opacity: 0.7 }}>
            <CornerDownLeft size={9} aria-hidden />
          </span>
        </button>
      </div>
      <p className="capture-tip" style={{ marginBottom: 0 }}>
        {t("Keep it small. You can add details, checklists and people later — or press Esc and come back.")}
      </p>
    </Modal>
  );
}
