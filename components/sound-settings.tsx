"use client";

import { useEffect, useState } from "react";
import { Bell, Check, Keyboard, Music2, Play, Sparkles, Volume2, VolumeX } from "lucide-react";
import { Toggle } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import {
  DEFAULT_SOUND_PREFS,
  getSoundPrefs,
  previewSound,
  setSoundPrefs,
  subscribeSoundPrefs,
  type SoundName,
  type SoundPalette,
  type SoundPrefs,
} from "@/lib/sound";

const PALETTES: { id: SoundPalette; name: string; description: string }[] = [
  { id: "wood", name: "Paper & wood", description: "Dry, short, close to the desk." },
  { id: "glass", name: "Felt & glass", description: "Warm, airy, a little more melodic." },
  { id: "hybrid", name: "Hybrid", description: "A paper transient with a soft tone." },
];

const PREVIEWS: { name: SoundName; label: string; icon: React.ReactNode }[] = [
  { name: "capture", label: "Capture", icon: <Sparkles size={12} /> },
  { name: "complete", label: "Complete", icon: <Check size={12} /> },
  { name: "reminder", label: "Reminder", icon: <Bell size={12} /> },
  { name: "move", label: "Move", icon: <Play size={12} /> },
  { name: "error", label: "Error", icon: <VolumeX size={12} /> },
  { name: "focus", label: "Focus", icon: <Music2 size={12} /> },
];

export function SoundSettings() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<SoundPrefs>(DEFAULT_SOUND_PREFS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPrefs(getSoundPrefs());
    setReady(true);
    return subscribeSoundPrefs(setPrefs);
  }, []);

  function update(patch: Partial<SoundPrefs>) {
    setPrefs(setSoundPrefs(patch));
  }

  if (!ready) return null;

  return (
    <div className="settings-card sound-settings" aria-label="Sound preferences">
      <div className="settings-row">
        <div className="settings-copy">
          <strong>{t("Interface sounds")}</strong>
          <span>{t("Quiet feedback for captures, completions, moves, and reminders. Generated locally; nothing is downloaded.")}</span>
        </div>
        <div className="settings-control">
          <Toggle label={t("Interface sounds")} checked={prefs.enabled} onChange={(next) => update({ enabled: next })} />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-copy">
          <strong>{t("Sound character")}</strong>
          <span>{t("Try each palette on your laptop speakers and headphones. There is no single right answer.")}</span>
        </div>
        <div className="settings-control sound-palettes">
          {PALETTES.map((palette) => (
            <button
              key={palette.id}
              type="button"
              className={`sound-palette${prefs.palette === palette.id ? " active" : ""}`}
              aria-pressed={prefs.palette === palette.id}
              onClick={() => {
                update({ palette: palette.id, enabled: true });
                previewSound("complete");
              }}
            >
              <span className="sound-palette-name">{t(palette.name)}</span>
              <span>{t(palette.description)}</span>
              <span className="sound-palette-dots" aria-hidden>
                <i /><i /><i />
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-copy">
          <strong>{t("Volume")}</strong>
          <span>{Math.round(prefs.volume * 100)}% · {t("deliberately low by default.")}</span>
        </div>
        <div className="settings-control inline sound-volume">
          <Volume2 size={15} aria-hidden style={{ color: "var(--muted)" }} />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(prefs.volume * 100)}
            aria-label="Sound volume"
            onChange={(event) => update({ volume: Number(event.target.value) / 100 })}
            onPointerUp={() => previewSound("tap")}
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-copy">
          <strong>{t("Typing texture")}</strong>
          <span>{t("An optional, very quiet tick while writing in a field. Off by default so long notes stay calm.")}</span>
        </div>
        <div className="settings-control">
          <Toggle label={t("Typing texture")} checked={prefs.typing} onChange={(next) => { update({ typing: next }); if (next) previewSound("key"); }} />
        </div>
      </div>

      <div className="settings-row sound-preview-row">
        <div className="settings-copy">
          <strong>{t("Listen before you choose")}</strong>
          <span>{t("Preview the whole kit in the current palette.")}</span>
        </div>
        <div className="settings-control sound-previews">
          {PREVIEWS.map((preview) => (
            <button
              key={preview.name}
              type="button"
              className="btn ghost sm"
              onClick={() => {
                if (!prefs.enabled) update({ enabled: true });
                previewSound(preview.name);
              }}
            >
              {preview.icon} {t(preview.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-copy">
          <strong>{t("Keyboard shortcuts")}</strong>
          <span>{t("Shortcut feedback is always part of the kit. Typing texture is the only per-key option.")}</span>
        </div>
        <div className="settings-control">
          <Keyboard size={16} aria-hidden style={{ color: "var(--faint)" }} />
        </div>
      </div>
    </div>
  );
}
