(() => {
  "use strict";

  const STORAGE_KEY = "drift-sound";
  const CHANGE_EVENT = "drift-sound-change";
  const DEFAULT_PREFS = { enabled: true, volume: 0.32, palette: "hybrid", typing: false };
  const PALETTES = {
    wood: {
      type: "triangle", filter: 1900, reverb: 0.12, tapNote: 280,
      capture: [392, 523.25], complete: [392, 587.33],
      reminder: [349.23, 440, 523.25], error: 146.83, focus: [196, 293.66]
    },
    glass: {
      type: "sine", filter: 4200, reverb: 0.28, tapNote: 880,
      capture: [659.25, 880], complete: [659.25, 987.77],
      reminder: [523.25, 659.25, 783.99], error: 164.81, focus: [220, 329.63]
    },
    hybrid: {
      type: "sine", filter: 2800, reverb: 0.2, tapNote: 620,
      capture: [523.25, 659.25], complete: [523.25, 783.99],
      reminder: [440, 554.37, 659.25], error: 155.56, focus: [196, 293.66]
    }
  };

  let prefs = readPrefs();
  let context = null;
  let master = null;
  let reverbSend = null;
  const lastPlayed = {};

  function clampVolume(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : DEFAULT_PREFS.volume;
  }

  function readPrefs() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_PREFS };
      const parsed = JSON.parse(raw);
      return {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_PREFS.enabled,
        volume: clampVolume(parsed.volume),
        palette: ["wood", "glass", "hybrid"].includes(parsed.palette) ? parsed.palette : DEFAULT_PREFS.palette,
        typing: typeof parsed.typing === "boolean" ? parsed.typing : DEFAULT_PREFS.typing
      };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  function getPrefs() {
    return { ...prefs };
  }

  function setPrefs(patch) {
    prefs = { ...prefs, ...patch };
    prefs.volume = clampVolume(prefs.volume);
    if (!PALETTES[prefs.palette]) prefs.palette = DEFAULT_PREFS.palette;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Private windows can refuse storage; sound still works for this tab.
    }
    if (master && context) master.gain.setTargetAtTime(prefs.volume, context.currentTime, 0.02);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: getPrefs() }));
    return getPrefs();
  }

  function subscribe(listener) {
    const onChange = (event) => listener(event.detail || getPrefs());
    const onStorage = (event) => {
      if (event.key !== STORAGE_KEY) return;
      prefs = readPrefs();
      listener(getPrefs());
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }

  function ensureAudio() {
    if (context) return context;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      context = new AudioCtor();
      master = context.createGain();
      master.gain.value = prefs.volume;
      master.connect(context.destination);

      const convolver = context.createConvolver();
      convolver.buffer = makeImpulse(context, 0.8);
      reverbSend = context.createGain();
      reverbSend.gain.value = 0.18;
      reverbSend.connect(convolver);
      convolver.connect(master);
      return context;
    } catch {
      context = null;
      return null;
    }
  }

  function makeImpulse(audio, seconds) {
    const length = Math.max(1, Math.floor(audio.sampleRate * seconds));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 3.2);
    }
    return buffer;
  }

  function connectVoice(node, reverbAmount) {
    if (!master || !context) return;
    node.connect(master);
    if (reverbSend) {
      const send = context.createGain();
      send.gain.value = reverbAmount;
      node.connect(send);
      send.connect(reverbSend);
    }
  }

  function tone(frequency, options = {}) {
    if (!context || !master) return;
    const now = context.currentTime + (options.delay || 0);
    const duration = options.duration || 0.2;
    const peak = Math.max(0.0002, options.gain || 0.06);
    const osc = context.createOscillator();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    osc.type = options.type || "sine";
    osc.frequency.setValueAtTime(Math.max(30, frequency), now);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(options.filter || 3200, now);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(filter);
    filter.connect(envelope);
    connectVoice(envelope, options.reverb || 0.16);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  function play(name) {
    if (!prefs.enabled) return;
    const now = Date.now();
    if (lastPlayed[name] && now - lastPlayed[name] < 45) return;
    lastPlayed[name] = now;
    const audio = ensureAudio();
    if (!audio) return;
    if (audio.state === "suspended") audio.resume().catch(() => undefined);
    const palette = PALETTES[prefs.palette] || PALETTES.hybrid;
    const common = {
      type: palette.type,
      filter: palette.filter,
      reverb: palette.reverb,
      duration: 0.2,
      gain: 0.045
    };
    if (name === "tap") tone(palette.tapNote, { ...common, duration: 0.08, gain: 0.028 });
    else if (name === "key") tone(palette.tapNote * 1.12, { ...common, duration: 0.035, gain: 0.012, reverb: 0.06 });
    else if (name === "capture") {
      tone(palette.capture[0], { ...common, duration: 0.16 });
      tone(palette.capture[1], { ...common, duration: 0.24, delay: 0.09, gain: 0.038 });
    } else if (name === "complete") {
      tone(palette.complete[0], { ...common, duration: 0.18 });
      tone(palette.complete[1], { ...common, duration: 0.32, delay: 0.11, gain: 0.05 });
    } else if (name === "reminder") {
      palette.reminder.forEach((note, index) => {
        tone(note, { ...common, duration: 0.2, delay: index * 0.14, gain: 0.038 });
      });
    } else if (name === "error") {
      tone(palette.error, { ...common, type: "triangle", duration: 0.34, gain: 0.045 });
    } else if (name === "move") {
      tone(palette.capture[0], { ...common, duration: 0.12, gain: 0.032 });
      tone(palette.capture[1], { ...common, duration: 0.17, delay: 0.07, gain: 0.03 });
    } else if (name === "focus") {
      tone(palette.focus[0], { ...common, duration: 0.4, gain: 0.04 });
      tone(palette.focus[1], { ...common, duration: 0.5, delay: 0.16, gain: 0.035 });
    }
  }

  function init() {
    const unlock = () => {
      const audio = ensureAudio();
      if (audio && audio.state === "suspended") audio.resume().catch(() => undefined);
    };
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", (event) => {
      if (!prefs.enabled || !prefs.typing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const target = event.target;
      const typing = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable);
      if (typing) play("key");
    });
  }

  window.DriftSound = { getPrefs, setPrefs, subscribe, play, init, DEFAULT_PREFS };
})();
