"use client";

/**
 * A tiny, local sound kit for Drift.
 *
 * The sounds are synthesized with the Web Audio API rather than loaded as
 * samples: no network request, no audio file to preload, and every voice can
 * share the same soft envelope. The point is a quiet sense of material
 * (paper, wood, glass) rather than a notification beep.
 */

export type SoundName = "tap" | "key" | "capture" | "complete" | "reminder" | "error" | "move" | "focus";
export type SoundPalette = "wood" | "glass" | "hybrid";

export type SoundPrefs = {
  enabled: boolean;
  volume: number;
  palette: SoundPalette;
  typing: boolean;
};

export const DEFAULT_SOUND_PREFS: SoundPrefs = {
  enabled: true,
  volume: 0.32,
  palette: "hybrid",
  typing: false,
};

const STORAGE_KEY = "drift-sound";
const CHANGE_EVENT = "drift-sound-change";

let cachedPrefs: SoundPrefs | null = null;
let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let reverbSend: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
const lastPlayed: Partial<Record<SoundName, number>> = {};

type PaletteConfig = {
  type: OscillatorType;
  filter: number;
  reverb: number;
  tapNote: number;
  capture: [number, number];
  complete: [number, number];
  reminder: [number, number, number];
  error: number;
  focus: [number, number];
};

const PALETTES: Record<SoundPalette, PaletteConfig> = {
  wood: {
    type: "triangle",
    filter: 1900,
    reverb: 0.12,
    tapNote: 280,
    capture: [392, 523.25],
    complete: [392, 587.33],
    reminder: [349.23, 440, 523.25],
    error: 146.83,
    focus: [196, 293.66],
  },
  glass: {
    type: "sine",
    filter: 4200,
    reverb: 0.28,
    tapNote: 880,
    capture: [659.25, 880],
    complete: [659.25, 987.77],
    reminder: [523.25, 659.25, 783.99],
    error: 164.81,
    focus: [220, 329.63],
  },
  hybrid: {
    type: "sine",
    filter: 2800,
    reverb: 0.2,
    tapNote: 620,
    capture: [523.25, 659.25],
    complete: [523.25, 783.99],
    reminder: [440, 554.37, 659.25],
    error: 155.56,
    focus: [196, 293.66],
  },
};

function isPalette(value: unknown): value is SoundPalette {
  return value === "wood" || value === "glass" || value === "hybrid";
}

function clampVolume(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SOUND_PREFS.volume;
  return Math.min(1, Math.max(0, numeric));
}

function readPrefs(): SoundPrefs {
  if (typeof window === "undefined") return DEFAULT_SOUND_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SOUND_PREFS;
    const parsed = JSON.parse(raw) as Partial<SoundPrefs>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SOUND_PREFS.enabled,
      volume: clampVolume(parsed.volume),
      palette: isPalette(parsed.palette) ? parsed.palette : DEFAULT_SOUND_PREFS.palette,
      typing: typeof parsed.typing === "boolean" ? parsed.typing : DEFAULT_SOUND_PREFS.typing,
    };
  } catch {
    return DEFAULT_SOUND_PREFS;
  }
}

export function getSoundPrefs(): SoundPrefs {
  if (!cachedPrefs) cachedPrefs = readPrefs();
  return cachedPrefs;
}

export function isTypingSoundEnabled(): boolean {
  return getSoundPrefs().typing;
}

export function setSoundPrefs(patch: Partial<SoundPrefs>): SoundPrefs {
  const next = { ...getSoundPrefs(), ...patch };
  next.volume = clampVolume(next.volume);
  if (!isPalette(next.palette)) next.palette = DEFAULT_SOUND_PREFS.palette;
  cachedPrefs = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A private window can refuse storage. Sound still works for this tab.
    }
    if (masterGain && audioContext) {
      masterGain.gain.setTargetAtTime(next.volume, audioContext.currentTime, 0.02);
    }
    window.dispatchEvent(new CustomEvent<SoundPrefs>(CHANGE_EVENT, { detail: next }));
  }
  return next;
}

export function subscribeSoundPrefs(listener: (prefs: SoundPrefs) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onChange = (event: Event) => {
    const detail = (event as CustomEvent<SoundPrefs>).detail;
    listener(detail ?? getSoundPrefs());
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cachedPrefs = readPrefs();
    listener(cachedPrefs);
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioContext) return audioContext;
  const ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!ctor) return null;
  try {
    audioContext = new ctor();
    masterGain = audioContext.createGain();
    masterGain.gain.value = getSoundPrefs().volume;
    masterGain.connect(audioContext.destination);

    const convolver = audioContext.createConvolver();
    convolver.buffer = makeImpulse(audioContext, 0.85);
    reverbSend = audioContext.createGain();
    reverbSend.gain.value = 0.18;
    reverbSend.connect(convolver);
    convolver.connect(masterGain);

    noiseBuffer = makeNoiseBuffer(audioContext);
    return audioContext;
  } catch {
    audioContext = null;
    return null;
  }
}

export async function initSound(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      // Autoplay policy: the next real gesture will try again.
    }
  }
}

function makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    const progress = index / length;
    data[index] = (Math.random() * 2 - 1) * Math.pow(1 - progress, 3.2);
  }
  return buffer;
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * 1.2));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }
  return buffer;
}

function connectVoice(node: AudioNode, ctx: AudioContext, reverbAmount: number) {
  if (!masterGain) return;
  node.connect(masterGain);
  if (reverbSend) {
    const send = ctx.createGain();
    send.gain.value = reverbAmount;
    node.connect(send);
    send.connect(reverbSend);
  }
}

function tone(
  ctx: AudioContext,
  frequency: number,
  options: {
    type?: OscillatorType;
    duration?: number;
    delay?: number;
    gain?: number;
    attack?: number;
    filter?: number;
    detune?: number;
    reverb?: number;
  } = {},
) {
  const now = ctx.currentTime + (options.delay ?? 0);
  const duration = options.duration ?? 0.22;
  const peak = Math.max(0.0002, options.gain ?? 0.06);
  const attack = Math.max(0.006, options.attack ?? 0.012);
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const envelope = ctx.createGain();

  osc.type = options.type ?? "sine";
  osc.frequency.setValueAtTime(frequency, now);
  if (options.detune) osc.detune.setValueAtTime(options.detune, now);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(options.filter ?? 3200, now);
  filter.Q.value = 0.45;

  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(peak, now + attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(filter);
  filter.connect(envelope);
  connectVoice(envelope, ctx, options.reverb ?? 0.16);
  osc.start(now);
  osc.stop(now + duration + 0.04);
}

function noise(
  ctx: AudioContext,
  options: {
    duration?: number;
    delay?: number;
    gain?: number;
    frequency?: number;
    endFrequency?: number;
    q?: number;
    reverb?: number;
  } = {},
) {
  if (!noiseBuffer) return;
  const now = ctx.currentTime + (options.delay ?? 0);
  const duration = options.duration ?? 0.045;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const envelope = ctx.createGain();
  source.buffer = noiseBuffer;

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(options.frequency ?? 1700, now);
  if (options.endFrequency) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, options.endFrequency), now + duration);
  }
  filter.Q.value = options.q ?? 0.8;

  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.gain ?? 0.035), now + 0.006);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(envelope);
  connectVoice(envelope, ctx, options.reverb ?? 0.08);
  source.start(now);
  source.stop(now + duration + 0.02);
}

function schedule(name: SoundName, ctx: AudioContext) {
  const prefs = getSoundPrefs();
  const palette = PALETTES[prefs.palette];

  switch (name) {
    case "tap":
      noise(ctx, { duration: 0.035, gain: 0.026, frequency: 1450, endFrequency: 900 });
      tone(ctx, palette.tapNote, { type: palette.type, duration: 0.1, gain: 0.022, filter: palette.filter, reverb: palette.reverb * 0.45 });
      break;
    case "key":
      noise(ctx, { duration: 0.018, gain: 0.012, frequency: 2200, endFrequency: 1500 });
      tone(ctx, palette.tapNote * 1.4, { type: palette.type, duration: 0.045, gain: 0.008, filter: palette.filter, reverb: palette.reverb * 0.25 });
      break;
    case "capture":
      noise(ctx, { duration: 0.055, gain: 0.03, frequency: 1300, endFrequency: 700 });
      tone(ctx, palette.capture[0], { type: palette.type, duration: 0.18, gain: 0.038, filter: palette.filter, reverb: palette.reverb * 0.7 });
      tone(ctx, palette.capture[1], { type: palette.type, duration: 0.24, delay: 0.07, gain: 0.03, filter: palette.filter, reverb: palette.reverb });
      break;
    case "complete":
      tone(ctx, palette.complete[0], { type: palette.type, duration: 0.3, gain: 0.04, filter: palette.filter, reverb: palette.reverb });
      tone(ctx, palette.complete[1], { type: palette.type, duration: 0.42, delay: 0.1, gain: 0.032, filter: palette.filter, reverb: palette.reverb * 1.1 });
      break;
    case "reminder":
      palette.reminder.forEach((note, index) => {
        tone(ctx, note, {
          type: palette.type,
          duration: 0.55,
          delay: index * 0.14,
          gain: 0.03,
          attack: 0.02,
          filter: palette.filter,
          reverb: palette.reverb * 1.25,
        });
      });
      break;
    case "error":
      tone(ctx, palette.error, { type: "sine", duration: 0.18, gain: 0.04, filter: 420, reverb: 0.04 });
      tone(ctx, palette.error * 1.5, { type: "sine", duration: 0.12, delay: 0.03, gain: 0.018, filter: 360, reverb: 0.03 });
      break;
    case "move":
      noise(ctx, { duration: 0.14, gain: 0.026, frequency: 1200, endFrequency: 420, q: 1.2, reverb: 0.1 });
      break;
    case "focus":
      tone(ctx, palette.focus[0], { type: "sine", duration: 0.8, gain: 0.026, attack: 0.12, filter: 800, reverb: 0.3 });
      tone(ctx, palette.focus[1], { type: "sine", duration: 0.7, delay: 0.08, gain: 0.018, attack: 0.16, filter: 1100, reverb: 0.32 });
      break;
    default:
      break;
  }
}

export function playSound(name: SoundName, options: { force?: boolean } = {}) {
  if (typeof window === "undefined") return;
  const prefs = getSoundPrefs();
  if (!prefs.enabled && !options.force) return;
  const now = Date.now();
  const cooldown = name === "key" ? 20 : name === "tap" ? 45 : 90;
  if (now - (lastPlayed[name] ?? 0) < cooldown) return;
  lastPlayed[name] = now;

  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
  if (masterGain) {
    masterGain.gain.setTargetAtTime(prefs.volume, ctx.currentTime, 0.015);
  }
  if (prefs.volume <= 0) return;
  schedule(name, ctx);
}

export function previewSound(name: SoundName) {
  playSound(name, { force: true });
}
