"use client";

import { useEffect, useState } from "react";
import { Bell, Check, Keyboard, Music2, Play, Sparkles, Volume2, VolumeX } from "lucide-react";
import { Toggle } from "@/components/ui";
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
  const [prefs, setPrefs] = useState<SoundPrefs>(DEFAULT_SOUND_PREFS);
  const [ready, setReady] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");

  useEffect(() => {
    setPrefs(getSoundPrefs());
    setNotificationPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    setReady(true);
    return subscribeSoundPrefs(setPrefs);
  }, []);

  function update(patch: Partial<SoundPrefs>) {
    setPrefs(setSoundPrefs(patch));
  }

  async function requestNotifications() {
    try {
      setNotificationPermission(await Notification.requestPermission());
    } catch {
      setNotificationPermission("unsupported");
    }
  }

  if (!ready) return null;

  return (
    <div className="settings-card sound-settings" aria-label="Sound preferences">
      <div className="settings-row">
        <div className="settings-copy">
          <strong>Interface sounds</strong>
          <span>Quiet feedback for captures, completions, moves, and reminders. Generated locally; nothing is downloaded.</span>
        </div>
        <div className="settings-control">
          <Toggle label="Enable interface sounds" checked={prefs.enabled} onChange={(next) => update({ enabled: next })} />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-copy">
          <strong>Sound character</strong>
          <span>Try each palette on your laptop speakers and headphones. There is no single right answer.</span>
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
              <span className="sound-palette-name">{palette.name}</span>
              <span>{palette.description}</span>
              <span className="sound-palette-dots" aria-hidden>
                <i /><i /><i />
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-copy">
          <strong>Volume</strong>
          <span>{Math.round(prefs.volume * 100)}% · deliberately low by default.</span>
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
          <strong>Typing texture</strong>
          <span>An optional, very quiet tick while writing in a field. Off by default so long notes stay calm.</span>
        </div>
        <div className="settings-control">
          <Toggle label="Enable typing sounds" checked={prefs.typing} onChange={(next) => { update({ typing: next }); if (next) previewSound("key"); }} />
        </div>
      </div>

      {notificationPermission !== "unsupported" ? (
        <div className="settings-row">
          <div className="settings-copy">
            <strong>Background reminders</strong>
            <span>When this tab is hidden, a browser notification can use the system notification sound. The in-app chime only plays while the app is visible.</span>
          </div>
          <div className="settings-control">
            {notificationPermission === "granted" ? (
              <span className="badge moss">Browser enabled</span>
            ) : notificationPermission === "denied" ? (
              <span className="field-hint">Blocked in browser settings</span>
            ) : (
              <button type="button" className="btn ghost sm" onClick={() => void requestNotifications()}>
                <Bell size={13} aria-hidden /> Allow notifications
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className="settings-row sound-preview-row">
        <div className="settings-copy">
          <strong>Listen before you choose</strong>
          <span>Preview the whole kit in the current palette.</span>
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
              {preview.icon} {preview.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-copy">
          <strong>Keyboard shortcuts</strong>
          <span>Shortcut feedback is always part of the kit. Typing texture is the only per-key option.</span>
        </div>
        <div className="settings-control">
          <Keyboard size={16} aria-hidden style={{ color: "var(--faint)" }} />
        </div>
      </div>
    </div>
  );
}
