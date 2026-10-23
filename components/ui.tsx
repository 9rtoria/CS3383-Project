"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { initials, priorityLabel } from "@/lib/format";
import type { Label, Member } from "@/lib/types";

/* ---------------- Modal / drawer ---------------- */

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
  drawer?: boolean;
  labelledBy?: string;
};

export function Modal({ open, onClose, title, eyebrow, children, footer, width, className = "", drawer = false, labelledBy }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const generatedId = useId();
  const titleId = labelledBy ?? `dialog-title-${generatedId}`;
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreFocus.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      const previous = restoreFocus.current;
      if (previous && document.contains(previous)) previous.focus();
    }
  }, [open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={ref}
      className={drawer ? "drawer-dialog" : ""}
      aria-labelledby={title ? titleId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={drawer ? `drawer-card ${className}` : `modal-card ${className}`}
        style={!drawer && width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined}
      >
        {drawer ? (
          <>
            <div className="drawer-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
                {title ? (
                  <div id={titleId} style={{ fontWeight: 600, fontSize: 13 }}>
                    {title}
                  </div>
                ) : null}
              </div>
              <button type="button" className="icon-btn" aria-label="Close panel" onClick={onClose}>
                <X size={18} />
              </button>
            </div>
            <div className="drawer-body">{children}</div>
            {footer ? <div className="drawer-foot">{footer}</div> : null}
          </>
        ) : (
          <>
            {title || eyebrow ? (
              <div className="modal-header">
                <div style={{ flex: 1 }}>
                  {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
                  {title ? <h2 id={titleId}>{title}</h2> : null}
                </div>
                <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>
                  <X size={18} />
                </button>
              </div>
            ) : null}
            <div className="modal-body">{children}</div>
            {footer ? <div className="modal-footer">{footer}</div> : null}
          </>
        )}
      </div>
    </dialog>,
    document.body,
  );
}

/* ---------------- Menus ---------------- */

type MenuProps = {
  trigger: ReactNode;
  triggerLabel?: string;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
  triggerClassName?: string;
  width?: number;
};

export function Menu({ trigger, triggerLabel, children, align = "right", className = "", triggerClassName = "icon-btn", width }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`menu-wrap ${className}`} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open ? (
        <div className={`menu ${align === "right" ? "align-right" : "align-left"} bottom`} role="menu" style={width ? { width: `min(${width}px, calc(100vw - 24px))` } : undefined}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  icon,
  shortcut,
  danger,
  active,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${danger ? " danger" : ""}${active ? " active" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span style={{ flex: 1 }}>{children}</span>
      {shortcut ? <span className="menu-shortcut">{shortcut}</span> : null}
    </button>
  );
}

/* ---------------- Small primitives ---------------- */

export function Avatar({ name, src, size = "md" }: { name?: string | null; src?: string | null; size?: "sm" | "md" | "lg" }) {
  const className = `avatar${size === "lg" ? " lg" : ""}`;
  const style = size === "sm" ? { width: 22, height: 22, fontSize: 9 } : undefined;
  if (src) {
    return <img src={src} alt={name ?? "Member"} className={className} style={{ ...style, objectFit: "cover" }} />;
  }
  return (
    <span className={className} style={style} aria-hidden title={name ?? undefined}>
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ members, max = 4 }: { members: Member[]; max?: number }) {
  const visible = members.slice(0, max);
  const extra = members.length - visible.length;
  return (
    <div className="avatar-stack" aria-label={`${members.length} members`}>
      {visible.map((member) => (
        <Avatar key={member.id} name={member.name} src={member.avatarUrl} size="sm" />
      ))}
      {extra > 0 ? <span className="avatar soft" style={{ width: 22, height: 22, fontSize: 9 }}>+{extra}</span> : null}
    </div>
  );
}

export function PriorityBadge({ priority, compact = false }: { priority: string; compact?: boolean }) {
  if (priority === "none") return null;
  const color = priority === "urgent" || priority === "high" ? "rose" : priority === "medium" ? "amber" : "blue";
  return (
    <span className={`badge ${color}`} style={compact ? { minHeight: 17, fontSize: 9 } : undefined}>
      {priorityLabel(priority)}
    </span>
  );
}

export function LabelChip({ label, dot = true }: { label: Label; dot?: boolean }) {
  return (
    <span className={`badge ${label.color || "slate"}`} title={label.name}>
      {dot ? <span className="label-dot" aria-hidden /> : null}
      {label.name}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <div className="empty-mark">{icon}</div> : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="inline" role="status" aria-live="polite" style={{ color: "var(--muted)", fontSize: 12 }}>
      <span className="spinner" aria-hidden />
      {label}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function InlineError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="field-error" role="alert" style={{ display: "flex", gap: 5, alignItems: "center" }}>
      <AlertTriangle size={13} aria-hidden />
      {children}
    </p>
  );
}

export function LoadingButton({ loading, block, children, className = "btn primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; block?: boolean }) {
  return (
    <button {...props} className={`${className}${block ? " block" : ""}`} disabled={loading || props.disabled}>
      {loading ? <Loader2 size={14} className="spin" style={{ animation: "spin 700ms linear infinite" }} aria-hidden /> : null}
      {children}
    </button>
  );
}

export function SuccessMark() {
  return (
    <span className="empty-mark" style={{ width: 38, height: 38, borderRadius: 12 }}>
      <Check size={18} />
    </span>
  );
}

export function Divider() {
  return <div className="divider" />;
}
