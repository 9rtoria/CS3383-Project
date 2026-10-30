"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, Pause, Play, RotateCcw, Sparkles, Timer } from "lucide-react";
import { playSound } from "@/lib/sound";
import { useI18n } from "@/lib/i18n";
import type { Task } from "@/lib/types";

type Phase = "ready" | "running" | "paused" | "done";

type Props = {
  task: Task | null;
  open: boolean;
  defaultMinutes: number;
  autoStart: boolean;
  onClose: () => void;
  onComplete: (minutes: number) => Promise<boolean>;
  onLogTime: (minutes: number) => Promise<void>;
};

function clock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function minutesLabel(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function FocusMode({ task, open, defaultMinutes, autoStart, onClose, onComplete, onLogTime }: Props) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const accumulated = useRef(0);
  const startedAt = useRef<number | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const targetMinutes = task?.estimateMinutes ?? defaultMinutes;
  const targetSeconds = Math.max(60, targetMinutes * 60);
  const progress = Math.min(1, elapsed / targetSeconds);
  const overEstimate = elapsed > targetSeconds;
  const actualMinutes = Math.max(1, Math.round(elapsed / 60));
  const deltaMinutes = actualMinutes - targetMinutes;
  const circumference = 2 * Math.PI * 112;

  useEffect(() => {
    if (!open) return;
    accumulated.current = 0;
    startedAt.current = null;
    setPhase("ready");
    setElapsed(0);
    setBusy(false);
    setError("");
    if (autoStart) {
      const timer = window.setTimeout(() => {
        startedAt.current = Date.now();
        setPhase("running");
        playSound("focus");
      }, 220);
      return () => window.clearTimeout(timer);
    }
  }, [autoStart, open, task?.id]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const tick = useCallback(() => {
    if (startedAt.current === null) return;
    setElapsed(accumulated.current + Math.floor((Date.now() - startedAt.current) / 1000));
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [phase, tick]);

  function begin() {
    if (phase === "running" || phase === "done") return;
    startedAt.current = Date.now();
    setPhase("running");
    setError("");
    playSound("focus");
  }

  function pause() {
    if (phase !== "running") return;
    accumulated.current += Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000);
    startedAt.current = null;
    setElapsed(accumulated.current);
    setPhase("paused");
    playSound("tap");
  }

  async function complete() {
    if (!task || busy || phase === "done") return;
    const minutes = Math.max(1, Math.round(elapsed / 60));
    if (startedAt.current !== null) {
      accumulated.current += Math.floor((Date.now() - startedAt.current) / 1000);
      startedAt.current = null;
      setElapsed(accumulated.current);
    }
    setBusy(true);
    setError("");
    try {
      const ok = await onComplete(minutes);
      if (ok) {
        setPhase("done");
        playSound("complete");
      } else {
        setError(t("Could not complete this task. Check its dependencies, then try again."));
      }
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Could not complete this task.");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (busy) return;
    const minutes = Math.max(0, Math.round(elapsed / 60));
    if (phase !== "done" && minutes > 0) {
      setBusy(true);
      try {
        await onLogTime(minutes);
      } catch {
        // Closing should never trap someone because a time log failed.
      } finally {
        setBusy(false);
      }
    }
    onClose();
  }

  if (typeof document === "undefined" || !task) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="focus-dialog"
      aria-labelledby="focus-mode-title"
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) void close();
      }}
    >
      <div className={`focus-mode${phase === "done" ? " done" : ""}`}>
        <header className="focus-mode-head">
          <span className="brand"><span className="brand-mark" aria-hidden>≈</span> Drift</span>
          <button type="button" className="btn ghost sm" onClick={() => void close()} disabled={busy}>
            <ChevronLeft size={13} aria-hidden /> {t("Leave focus")}
          </button>
        </header>

        {phase === "done" ? (
          <div className="focus-done" role="status">
            <span className="focus-done-mark"><Check size={28} aria-hidden /></span>
            <div className="eyebrow"><Sparkles size={12} aria-hidden /> {t("Session complete")}</div>
            <h1 id="focus-mode-title">{t("That's enough.")}</h1>
            <p>{clock(elapsed)} {t("of attention for")} <strong>{task.title}</strong>. {t("The estimate was {{minutes}} minutes; the point was to begin.", { minutes: targetMinutes })}</p>
            <div className="focus-done-stats">
              <span><strong>{actualMinutes}m</strong> {t("tracked")}</span>
              <span><strong>{minutesLabel(targetMinutes)}</strong> {t("estimated")}</span>
              <span><strong>{Math.abs(deltaMinutes)}m</strong> {deltaMinutes > 0 ? t("over") : deltaMinutes < 0 ? t("under") : t("on estimate")}</span>
            </div>
            <button type="button" className="btn primary lg" onClick={() => void close()}>
              {t("Return to Today")}
            </button>
          </div>
        ) : (
          <>
            <div className="focus-stage">
              <div className={`focus-orb${phase === "running" ? " breathing" : ""}`} aria-hidden />
              <div className="focus-ring-wrap">
                <svg viewBox="0 0 248 248" className="focus-ring" aria-hidden>
                  <circle className="focus-ring-track" cx="124" cy="124" r="112" />
                  <circle
                    className={`focus-ring-value${overEstimate ? " over" : ""}`}
                    cx="124"
                    cy="124"
                    r="112"
                    style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - progress) }}
                  />
                </svg>
                <div className="focus-ring-copy">
                  <span className="focus-phase" aria-live="polite">
                    {phase === "ready" ? t("Ready when you are") : phase === "running" ? t("In focus") : t("Paused")}
                  </span>
                  <strong>{clock(elapsed)}</strong>
                  <span>{overEstimate ? t("past the estimate — still yours") : `${t("of")} ${minutesLabel(targetMinutes)} ${t("estimated")}`}</span>
                </div>
              </div>
            </div>

            <div className="focus-task-copy">
              <div className="eyebrow"><Timer size={12} aria-hidden /> {task.board?.name ?? "Task"} · {task.column?.name ?? "Open"}</div>
              <h1 id="focus-mode-title">{task.title}</h1>
              <p>{phase === "running" ? t("The rest can wait. You only need the next small move.") : phase === "paused" ? t("Paused. Take the breath, then decide.") : t("One task. One timer. No feed, no backlog, no noise.")}</p>
              <div className="focus-meta">
                {task.estimateMinutes ? <span className="badge slate"><Timer size={10} aria-hidden /> {task.estimateMinutes}m estimate</span> : null}
                {task.actualMinutes ? <span className="badge accent">{task.actualMinutes}m tracked before</span> : null}
                {task.priority !== "none" ? <span className="badge rose">{task.priority}</span> : null}
                {task.labels.slice(0, 3).map((label) => <span key={label.id} className={`badge ${label.color}`}>{label.name}</span>)}
              </div>
            </div>

            <div className="focus-controls">
              {phase === "running" ? (
                <button type="button" className="btn lg" onClick={pause}><Pause size={15} aria-hidden /> {t("Pause")}</button>
              ) : (
                <button type="button" className="btn primary lg" onClick={begin} autoFocus>
                  <Play size={15} aria-hidden /> {phase === "paused" ? t("Resume focus") : t("Begin focus")}
                </button>
              )}
              <button type="button" className="btn soft lg" onClick={() => void complete()} disabled={busy || elapsed < 1}>
                <Check size={15} aria-hidden /> {busy ? t("Saving…") : t("Complete task")}
              </button>
              {elapsed > 0 ? (
                <button type="button" className="btn ghost sm" onClick={() => void close()} disabled={busy}>
                  <RotateCcw size={12} aria-hidden /> {t("Log time and leave")}
                </button>
              ) : null}
            </div>
            {error ? <p className="field-error" role="alert">{error}</p> : null}
            <p className="focus-hint">{t("Time is saved to this task when you complete it or leave. No audio is captured; task text stays in this workspace.")}</p>
          </>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
