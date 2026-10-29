"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AutoPlanModal } from "@/components/auto-plan-modal";
import { AutoPlanPanel } from "@/components/auto-plan-panel";
import { useToast } from "@/components/toast";
import { api, formatApiError } from "@/lib/client";
import type { AutoPlanOptionId, AutoPlanPreview } from "@/lib/auto-plan";
import type { AutoPlanMode } from "@/lib/preferences";

export function AutoPlanController({
  workspaceId,
  enabled,
  mode,
  refreshMinutes,
  refreshKey,
  onChanged,
}: {
  workspaceId: string;
  enabled: boolean;
  mode: AutoPlanMode;
  refreshMinutes: number;
  refreshKey: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<AutoPlanPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const applyingRef = useRef(false);
  const lastAutoApplyAt = useRef(0);

  const applyOption = useCallback(async (optionId: AutoPlanOptionId, safe: boolean, silent = false, delegated = false) => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    try {
      const result = await api<{ preview: AutoPlanPreview; appliedBlocks: number; undoId: string }>("/api/auto-plan", {
        method: "POST",
        workspaceId,
        body: { action: "apply", workspaceId, optionId, safe, delegated, horizonDays: 7 },
      });
      lastAutoApplyAt.current = Date.now();
      setPreview(result.preview);
      setOpen(false);
      setError("");
      onChanged();
      if (!silent || result.appliedBlocks > 0) {
        toast.push({
          message: `Auto-plan applied · ${result.appliedBlocks} block${result.appliedBlocks === 1 ? "" : "s"} scheduled.`,
          tone: "success",
          actionLabel: "Undo",
          onAction: async () => {
            try {
              await api(`/api/undo/${result.undoId}`, { method: "POST", workspaceId, body: {} });
              onChanged();
              toast.success("Previous plan restored.");
            } catch (undoError) {
              toast.error(formatApiError(undoError));
            }
          },
        });
      }
    } catch (applyError) {
      if (!silent) {
        setError(formatApiError(applyError));
        toast.error(formatApiError(applyError));
      }
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }, [onChanged, toast, workspaceId]);

  const loadPreview = useCallback(async (autoApply: boolean) => {
    if (!enabled) {
      setPreview(null);
      return;
    }
    setLoading(true);
    try {
      const result = await api<{ preview: AutoPlanPreview }>("/api/auto-plan", {
        method: "POST",
        workspaceId,
        body: { action: "preview", workspaceId, horizonDays: 7 },
      });
      setPreview(result.preview);
      setError("");
      if (
        autoApply &&
        mode !== "suggest" &&
        Date.now() - lastAutoApplyAt.current > 30_000
      ) {
        const option = result.preview.options.find((entry) => entry.id === "balanced");
        if (option?.blocks.length) await applyOption(option.id, mode === "safe", true, mode === "delegated");
      }
    } catch (loadError) {
      setError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }, [applyOption, enabled, mode, workspaceId]);

  const clearPlan = useCallback(async () => {
    if (!window.confirm("Clear scheduled Auto-plan blocks? Your today selections will remain.")) return;
    setLoading(true);
    try {
      const result = await api<{ cleared: number }>("/api/auto-plan", {
        method: "POST",
        workspaceId,
        body: { action: "clear", workspaceId, horizonDays: 7 },
      });
      setPreview(null);
      lastAutoApplyAt.current = Date.now();
      onChanged();
      toast.success(`${result.cleared} scheduled block${result.cleared === 1 ? "" : "s"} cleared.`);
      void loadPreview(false);
    } catch (clearError) {
      toast.error(formatApiError(clearError));
    } finally {
      setLoading(false);
    }
  }, [loadPreview, onChanged, toast, workspaceId]);

  useEffect(() => {
    if (!enabled) {
      setPreview(null);
      return;
    }
    void loadPreview(true);
    if (!refreshMinutes) return;
    const timer = window.setInterval(() => void loadPreview(true), refreshMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, loadPreview, refreshKey, refreshMinutes]);

  if (!enabled) return null;

  return (
    <>
      <AutoPlanPanel
        preview={preview}
        loading={loading}
        error={error}
        mode={mode}
        onRefresh={() => void loadPreview(false)}
        onPreview={() => {
          if (!preview) void loadPreview(false);
          setOpen(true);
        }}
        onClear={() => void clearPlan()}
      />
      <AutoPlanModal
        open={open}
        preview={preview}
        applying={applying}
        onClose={() => { if (!applying) setOpen(false); }}
        onApply={(optionId) => void applyOption(optionId, false, false, mode === "delegated")}
      />
    </>
  );
}
