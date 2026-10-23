"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, X } from "lucide-react";

type ToastTone = "default" | "error" | "success";
type ToastInput = {
  message: string;
  tone?: ToastTone;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  duration?: number;
};
type ToastItem = ToastInput & { id: string };

type ToastApi = {
  push: (input: ToastInput | string) => void;
  error: (message: string) => void;
  success: (message: string) => void;
  undo: (message: string, onUndo: () => void | Promise<void>) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

function createToastId() {
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (input: ToastInput | string) => {
      const toast: ToastInput = typeof input === "string" ? { message: input } : input;
      const id = createToastId();
      setItems((current) => [...current.slice(-3), { ...toast, id }]);
      const duration = toast.duration ?? (toast.tone === "error" ? 7000 : 5000);
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      error: (message) => push({ message, tone: "error" }),
      success: (message) => push({ message, tone: "success" }),
      undo: (message, onUndo) =>
        push({
          message,
          actionLabel: "Undo",
          duration: 9000,
          onAction: onUndo,
        }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="region" aria-label="Notifications">
        {items.map((toast) => (
          <div key={toast.id} className={`toast${toast.tone === "error" ? " error" : ""}`} role="status" aria-live="polite">
            {toast.tone === "success" ? <Check size={16} aria-hidden /> : toast.tone === "error" ? <AlertCircle size={16} aria-hidden /> : null}
            <span className="toast-message">
              {toast.message}
              {toast.actionLabel && toast.onAction ? null : null}
            </span>
            {toast.actionLabel && toast.onAction ? (
              <button
                type="button"
                className="toast-action"
                onClick={async () => {
                  try {
                    await toast.onAction?.();
                  } finally {
                    dismiss(toast.id);
                  }
                }}
              >
                {toast.actionLabel}
              </button>
            ) : null}
            <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
