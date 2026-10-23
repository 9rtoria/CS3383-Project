"use client";

import { useEffect } from "react";
import { setUnauthorizedHandler } from "@/lib/client";

/**
 * Registers the offline shell and turns a stale session into a single redirect
 * to the auth screen. Both run after paint so they never block first input.
 */
export function Runtime() {
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (window.location.pathname.startsWith("/auth")) return;
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/auth?next=${encodeURIComponent(next)}`);
    });

    const applyTheme = () => {
      const stored = localStorage.getItem("drift-theme") ?? "system";
      const dark = stored === "dark" || (stored === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    applyTheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    window.addEventListener("drift-theme-change", applyTheme);
    window.addEventListener("storage", applyTheme);

    if ("serviceWorker" in navigator) {
      const register = () => navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }

    return () => {
      setUnauthorizedHandler(null);
      media.removeEventListener("change", applyTheme);
      window.removeEventListener("drift-theme-change", applyTheme);
      window.removeEventListener("storage", applyTheme);
    };
  }, []);

  return null;
}
