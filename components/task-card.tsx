"use client";

import { useId } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent } from "react";
import { CalendarDays, CheckSquare, Link2, MessageSquare, Paperclip, Repeat2, Timer } from "lucide-react";
import { Avatar, LabelChip, PriorityBadge } from "@/components/ui";
import { formatDue, isOverdue } from "@/lib/format";
import type { Task } from "@/lib/types";

type Props = {
  task: Task;
  onOpen: (taskId: string) => void;
  onDragStart?: (task: Task, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
  onKeyDown?: (task: Task, event: KeyboardEvent<HTMLElement>) => void;
  dragging?: boolean;
  selected?: boolean;
  dense?: boolean;
};

export function TaskCard({ task, onOpen, onDragStart, onDragEnd, onDragOver, onDrop, onKeyDown, dragging, selected }: Props) {
  const hintId = useId();
  const checklist = task.subtasks ?? [];
  const done = checklist.filter((item) => item.completed).length;
  const overdue = isOverdue(task.dueDate, task.completedAt);
  const labels = (task.labels ?? []).slice(0, 3);
  const style: CSSProperties | undefined =
    checklist.length > 8 ? { contentVisibility: "auto", containIntrinsicSize: "90px" } : undefined;

  return (
    <article
      className={`task-card${dragging ? " dragging" : ""}${selected ? " selected" : ""}${task.completedAt ? " completed" : ""}`}
      style={style}
      draggable
      tabIndex={0}
      role="button"
      aria-roledescription="Draggable task card"
      aria-describedby={hintId}
      onClick={() => onOpen(task.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(task.id);
          return;
        }
        onKeyDown?.(task, event);
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart?.(task, event);
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span id={hintId} className="sr-only">
        {task.column?.name ? `${task.column.name}. ` : ""}Press Enter to open. Alt plus arrow keys to move.
      </span>
      {task.priority !== "none" || labels.length ? (
        <div className="task-topline">
          <PriorityBadge priority={task.priority} compact />
          {labels.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
        </div>
      ) : null}
      <h3 className="task-title">{task.title}</h3>
      {task.description ? <p className="task-desc">{task.description}</p> : null}
      {task.dueDate || checklist.length || task.openDependencies || task.commentCount || task.attachmentCount || task.assignee || task.recurrenceRule ? (
        <div className="task-foot">
          {task.dueDate ? (
            <span className={`task-foot-meta${overdue ? " overdue" : ""}`}>
              <CalendarDays size={11} aria-hidden />
              {formatDue(task.dueDate, task.dueAllDay)}
            </span>
          ) : null}
          {task.recurrenceRule ? (
            <span className="task-foot-meta" title="Repeats">
              <Repeat2 size={11} aria-hidden />
            </span>
          ) : null}
          {task.openDependencies ? (
            <span className="task-foot-meta blocked" title={`${task.openDependencies} open dependencies`}>
              <Link2 size={11} aria-hidden />
              {task.openDependencies}
            </span>
          ) : null}
          {task.estimateMinutes ? (
            <span className="task-foot-meta">
              <Timer size={11} aria-hidden />
              {task.estimateMinutes}m
            </span>
          ) : null}
          <span className="task-foot-right">
            {checklist.length ? (
              <span className="check-count">
                <CheckSquare size={10} aria-hidden />
                {done}/{checklist.length}
              </span>
            ) : null}
            {task.commentCount ? (
              <span className="check-count">
                <MessageSquare size={10} aria-hidden />
                {task.commentCount}
              </span>
            ) : null}
            {task.attachmentCount ? (
              <span className="check-count">
                <Paperclip size={10} aria-hidden />
                {task.attachmentCount}
              </span>
            ) : null}
            {task.assignee ? <Avatar name={task.assignee.name} src={task.assignee.avatarUrl} size="sm" /> : null}
          </span>
        </div>
      ) : null}
    </article>
  );
}
