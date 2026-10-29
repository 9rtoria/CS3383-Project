"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Check, Clock3, Play, RefreshCw, Sparkles, Timer } from "lucide-react";
import { playSound } from "@/lib/sound";
import { useI18n } from "@/lib/i18n";
import type { PlanBlock, TodayPayload } from "@/lib/types";

type Suggestion = TodayPayload["suggestions"][number];

type Props = {
  tasks: Suggestion[];
  capacity: TodayPayload["capacity"];
  planBlocks?: PlanBlock[];
  busy?: string | null;
  note?: string | null;
  workdayStart: number;
  workdayEnd: number;
  blockBufferMinutes: number;
  timeFormat: "auto" | "12" | "24";
  onOpenTask: (taskId: string) => void;
  onFocusTask: (task: Suggestion) => void;
  onDismiss: (taskId: string) => void;
  onRebalance: () => void;
};

const DAY_MINUTES = 24 * 60;
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

function formatClock(minutes: number, timeFormat: "auto" | "12" | "24"): string {
  const normalized = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  if (timeFormat === "24") return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function roundUp(minutes: number, step: number): number {
  return Math.ceil(minutes / step) * step;
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function taskStart(task: Suggestion, cursor: number): number {
  if (!task.dueDate || task.dueAllDay) return cursor;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return cursor;
  const dueMinutes = minutesOfDay(due);
  return dueMinutes >= cursor ? dueMinutes : cursor;
}

export function DayFlow({ tasks, capacity, planBlocks = [], busy, note, workdayStart, workdayEnd, blockBufferMinutes, timeFormat, onOpenTask, onFocusTask, onDismiss, onRebalance }: Props) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => new Date());
  // Freeze the layout anchor when the view opens. The "now" marker updates
  // every minute, but the plan itself should not slide down the rail while
  // someone is looking at it.
  const [anchorMinutes] = useState(() => Math.max(6 * 60, roundUp(minutesOfDay(new Date()), 15)));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [laterOver, setLaterOver] = useState(false);
  const railWrapRef = useRef<HTMLDivElement | null>(null);
  const didScrollRail = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const selected = useMemo(
    () => tasks.filter((task) => task.accepted || task.selected).slice(0, 14),
    [tasks],
  );

  const scheduled = useMemo(
    () =>
      planBlocks
        .map((block) => {
          const task = tasks.find((entry) => entry.id === block.taskId);
          return task
            ? {
                task: { ...task, accepted: true },
                start: block.startMinute,
                duration: block.minutes,
                blockId: block.id,
              }
            : null;
        })
        .filter((block): block is { task: Suggestion; start: number; duration: number; blockId: string } => Boolean(block)),
    [planBlocks, tasks],
  );

  const blocks = useMemo(
    () =>
      scheduled.length
        ? scheduled
        : selected
            .reduce<{ cursor: number; blocks: { task: Suggestion; start: number; duration: number; blockId?: string }[] }>(
              (state, task) => {
                const duration = Math.max(15, task.suggestedMinutes || task.estimateMinutes || 30);
                const rawStart = taskStart(task, state.cursor);
                const start = rawStart + duration > DAY_MINUTES ? Math.max(0, DAY_MINUTES - duration) : rawStart;
                return {
                  cursor: Math.max(state.cursor, start + duration + Math.max(0, blockBufferMinutes)),
                  blocks: [...state.blocks, { task, start, duration }],
                };
              },
              { cursor: anchorMinutes, blocks: [] },
            )
            .blocks,
    [anchorMinutes, blockBufferMinutes, scheduled, selected],
  );

  const nowMinutes = minutesOfDay(now);

  useEffect(() => {
    if (didScrollRail.current) return;
    const wrap = railWrapRef.current;
    if (!wrap || wrap.scrollWidth <= wrap.clientWidth + 1) return;
    const focusMinutes = blocks[0]?.start ?? nowMinutes;
    const target = (focusMinutes / DAY_MINUTES) * wrap.scrollWidth - wrap.clientWidth / 2;
    wrap.scrollLeft = Math.max(0, Math.min(wrap.scrollWidth - wrap.clientWidth, target));
    didScrollRail.current = true;
  }, [blocks, nowMinutes]);

  const rawPercent = capacity.totalMinutes > 0 ? (capacity.selectedMinutes / capacity.totalMinutes) * 100 : 0;
  const ringPercent = Math.min(100, Math.max(0, rawPercent));
  const over = capacity.overbooked;
  const next = blocks.find((block) => block.start + block.duration >= nowMinutes) ?? null;
  const circumference = 2 * Math.PI * 31;

  function onBlockDragStart(event: DragEvent<HTMLElement>, task: Suggestion) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    setDraggingId(task.id);
    playSound("tap");
  }

  function onLaterDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setLaterOver(false);
    if (!taskId) return;
    playSound("move");
    onDismiss(taskId);
  }

  return (
    <section className="day-flow" aria-labelledby="day-flow-title">
      <div className="day-flow-head">
        <div>
          <div className="eyebrow"><Sparkles size={12} aria-hidden /> {t("Signature view")}</div>
          <h2 className="section-title" id="day-flow-title">{t("Day flow")}</h2>
          <p className="section-subtitle">{t("Your chosen work laid across the day. Blocks breathe when the plan changes.")}</p>
          <div className="day-flow-legend" aria-hidden>
            <span><i className="chosen" /> {t("chosen")}</span>
            <span><i className="suggested" /> {t("suggestion")}</span>
          </div>
        </div>
        <div className={`day-flow-ring${over ? " over" : ""}`} role="img" aria-label={`${Math.round(rawPercent)}% of daily capacity planned`}>
          <svg viewBox="0 0 74 74" width="74" height="74" aria-hidden>
            <circle className="day-flow-ring-track" cx="37" cy="37" r="31" fill="none" />
            <circle
              className="day-flow-ring-value"
              cx="37"
              cy="37"
              r="31"
              fill="none"
              style={{
                strokeDasharray: circumference,
                strokeDashoffset: circumference * (1 - ringPercent / 100),
              }}
            />
          </svg>
          <div className="day-flow-ring-copy">
            <strong>{Math.round(rawPercent)}%</strong>
            <span>{over ? t("over") : t("planned")}</span>
          </div>
        </div>
      </div>

      <div className="day-flow-rail-wrap" ref={railWrapRef}>
        <div className="day-flow-rail" role="group" aria-label="A 24 hour timeline of today's selected tasks">
          <div className="day-flow-grid" aria-hidden>
            {workdayStart > 0 ? (
              <span className="day-flow-outside" style={{ left: 0, width: `${(workdayStart / 24) * 100}%` }} />
            ) : null}
            {workdayEnd < 24 ? (
              <span className="day-flow-outside" style={{ left: `${(workdayEnd / 24) * 100}%`, width: `${((24 - workdayEnd) / 24) * 100}%` }} />
            ) : null}
            {HOURS.map((hour) => (
              <span key={hour} className="day-flow-grid-line" style={{ left: `${(hour / 24) * 100}%` }} />
            ))}
            <span className="day-flow-night" aria-hidden />
            {nowMinutes >= 0 && nowMinutes <= DAY_MINUTES ? (
              <span className="day-flow-now" style={{ left: `${(nowMinutes / 1440) * 100}%` }}>
                <span>{t("now")}</span>
              </span>
            ) : null}
          </div>

          {blocks.length ? (
            blocks.map(({ task, start, duration, blockId }) => {
              const width = (duration / DAY_MINUTES) * 100;
              const wide = duration >= (blockId ? 60 : 90);
              return (
                <button
                  type="button"
                  key={blockId ?? task.id}
                  className={`day-flow-block${task.accepted ? " chosen" : " suggested"}${task.blocked ? " blocked" : ""}${draggingId === task.id ? " dragging" : ""} priority-${task.priority}`}
                  style={{ left: `${(start / DAY_MINUTES) * 100}%`, width: `${Math.max(0.7, width)}%` }}
                  draggable
                  onDragStart={(event) => onBlockDragStart(event, task)}
                  onDragEnd={() => setDraggingId(null)}
                  onClick={() => onOpenTask(task.id)}
                  title={`${formatClock(start, timeFormat)}–${formatClock(start + duration, timeFormat)} · ${task.title}${task.accepted ? ` · ${t("chosen")}` : ` · ${t("suggestion")}`}`}
                  aria-label={`${task.title}, ${formatClock(start, timeFormat)} to ${formatClock(start + duration, timeFormat)}${task.accepted ? `, ${t("chosen")}` : `, ${t("suggestion")}`}`}
                >
                  <span className="day-flow-block-mark" aria-hidden>
                    {task.accepted ? <Check size={10} /> : <span />}
                  </span>
                  {wide ? <span className="day-flow-block-title">{task.title}</span> : null}
                  {wide ? <span className="day-flow-block-time">{formatClock(start, timeFormat)} · {duration}m</span> : null}
                </button>
              );
            })
          ) : (
            <div className="day-flow-empty">
              <span className="day-flow-empty-mark"><Clock3 size={16} aria-hidden /></span>
              <span>{t("Nothing on the rail yet. Choose one task below and watch the day take shape.")}</span>
            </div>
          )}
        </div>

        <div className="day-flow-hours" aria-hidden>
          {[0, 6, 12, 18, 24].map((hour) => (
            <span key={hour} style={{ left: `${(hour / 24) * 100}%` }}>{hour === 24 ? (timeFormat === "24" ? "24:00" : "12 AM") : formatClock(hour * 60, timeFormat)}</span>
          ))}
        </div>
      </div>

      <div className="day-flow-foot">
        <div className="day-flow-next">
          {next ? (
            <>
              <span className="day-flow-next-dot" aria-hidden />
              <span><strong>{next.task.title}</strong><span>{formatClock(next.start, timeFormat)} · {next.duration}m{next.task.accepted ? ` · ${t("chosen")}` : ` · ${t("suggestion")}`}</span></span>
            </>
          ) : (
            <span>
              <strong>{blocks.length ? t("The rail is behind you.") : t("The rail is clear.")}</strong>
              <span>{blocks.length ? t("Pick one small thing for the rest of the day, or stop here.") : t("Protect the empty space, or add one small thing.")}</span>
            </span>
          )}
        </div>
        <div className="day-flow-actions">
          {next ? (
            <button type="button" className="btn ghost sm" onClick={() => onFocusTask(next.task)}>
              <Play size={12} aria-hidden /> {t("Focus next")}
            </button>
          ) : null}
          <button type="button" className="btn soft sm" onClick={onRebalance} disabled={busy === "rebalance"}>
            <RefreshCw size={12} className={busy === "rebalance" ? "spin" : undefined} aria-hidden /> {t("Rebalance")}
          </button>
        </div>
      </div>

      <div
        className={`day-flow-later${laterOver ? " active" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setLaterOver(true);
        }}
        onDragLeave={() => setLaterOver(false)}
        onDrop={onLaterDrop}
      >
        <Timer size={13} aria-hidden />
        <span>{t("Drag a block here — or use Later on a task below — to let it wait for another day.")}</span>
        {note ? <span className="day-flow-note">{note}</span> : null}
      </div>
    </section>
  );
}
