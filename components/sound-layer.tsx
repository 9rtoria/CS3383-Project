"use client";

import { useEffect } from "react";
import { initSound, isTypingSoundEnabled, playSound } from "@/lib/sound";

/**
 * Initializes audio on the first real gesture and adds the optional typing
 * texture. Keeping this outside the app tree means settings and auth screens
 * get the same behaviour without each page wiring an AudioContext.
 */
export function SoundLayer() {
  useEffect(() => {
    const unlock = () => {
      void initSound();
    };
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTypingSoundEnabled()) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1) return;
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (!typing) return;
      playSound("key");
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
