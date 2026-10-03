// Fully synthesized WebAudio: background music loop + SFX. No audio files.
// Audio starts only after the first user gesture (autoplay policy).
// Independent musicEnabled / sfxEnabled flags, persisted to localStorage
// (and synced with the player doc by AuthContext).

const LS_MUSIC = 'mythica.musicEnabled';
const LS_SFX = 'mythica.sfxEnabled';

function lsGet(key, fallback) {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function lsSet(key, v) {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

const state = {
  musicEnabled: typeof window === 'undefined' ? true : lsGet(LS_MUSIC, true),
  sfxEnabled: typeof window === 'undefined' ? true : lsGet(LS_SFX, true),
  ctx: null,
  master: null,
  musicGain: null,
  sfxGain: null,
  musicTimer: null,
  step: 0,
  nextStepTime: 0,
  started: false,
};

// Dark-fantasy progression: Am — F — Dm — E (A harmonic minor flavor)
const CHORDS = [
  [110.0, 130.81, 164.81], // Am (A2 C3 E3)
  [87.31, 110.0, 130.81], // F  (F2 A2 C3)
  [73.42, 87.31, 110.0], // Dm (D2 F2 A2)
  [82.41, 103.83, 123.47], // E  (E2 G#2 B2)
];
const ARP_PATTERN = [0, 1, 2, 1, 0, 2, 1, 2]; // indexes into chord tones, +octave shimmer
const STEP_DUR = 0.34; // ~10.9s loop of 32 steps
const STEPS_PER_CHORD = 8;

export function isMusicEnabled() {
  return state.musicEnabled;
}
export function isSfxEnabled() {
  return state.sfxEnabled;
}
export function setMusicEnabled(v) {
  state.musicEnabled = Boolean(v);
  lsSet(LS_MUSIC, state.musicEnabled);
  if (state.musicGain) state.musicGain.gain.value = state.musicEnabled ? 0.5 : 0;
}
export function setSfxEnabled(v) {
  state.sfxEnabled = Boolean(v);
  lsSet(LS_SFX, state.sfxEnabled);
}

function ensureCtx() {
  if (typeof window === 'undefined') return null;
  if (state.ctx) return state.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  state.ctx = ctx;
  state.master = ctx.createGain();
  state.master.gain.value = 0.9;
  state.master.connect(ctx.destination);
  state.musicGain = ctx.createGain();
  state.musicGain.gain.value = state.musicEnabled ? 0.5 : 0;
  state.musicGain.connect(state.master);
  state.sfxGain = ctx.createGain();
  state.sfxGain.gain.value = 0.9;
  state.sfxGain.connect(state.master);
  return ctx;
}

function padChord(chord, t, dur) {
  const ctx = state.ctx;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.16, t + dur * 0.35);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  filter.connect(g);
  g.connect(state.musicGain);
  chord.forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = i === 0 ? 'sine' : 'triangle';
    o.frequency.value = f;
    o.detune.value = i === 1 ? 6 : i === 2 ? -6 : 0;
    o.connect(filter);
    o.start(t);
    o.stop(t + dur + 0.05);
  });
}

function pluck(freq, t, vol = 0.22, type = 'triangle') {
  const ctx = state.ctx;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(g);
  g.connect(state.musicGain);
  o.start(t);
  o.stop(t + 0.7);
}

function scheduleStep(stepIdx, t) {
  const chordIdx = Math.floor(stepIdx / STEPS_PER_CHORD) % CHORDS.length;
  const chord = CHORDS[chordIdx];
  const inChord = stepIdx % STEPS_PER_CHORD;
  if (inChord === 0) padChord(chord, t, STEPS_PER_CHORD * STEP_DUR);
  // Arpeggio: play on most steps, skip one for breathing room
  if (inChord !== 6) {
    const tone = chord[ARP_PATTERN[inChord]];
    const octave = inChord % 3 === 2 ? 2 : 4;
    pluck(tone * octave, t, inChord % 2 === 0 ? 0.2 : 0.13);
  }
  // Deep root drone pulse
  if (inChord === 0 || inChord === 4) pluck(chord[0] / 2, t, 0.18, 'sine');
}

function startMusicLoop() {
  if (state.musicTimer || !state.ctx) return;
  state.nextStepTime = state.ctx.currentTime + 0.1;
  state.step = 0;
  state.musicTimer = setInterval(() => {
    if (!state.ctx) return;
    while (state.nextStepTime < state.ctx.currentTime + 0.5) {
      scheduleStep(state.step, state.nextStepTime);
      state.nextStepTime += STEP_DUR;
      state.step = (state.step + 1) % (CHORDS.length * STEPS_PER_CHORD);
    }
  }, 120);
}

// Call once from a user gesture. Safe to call repeatedly.
export function unlockAudio() {
  const ctx = ensureCtx();
  if (!ctx || state.started) return;
  state.started = true;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  startMusicLoop();
}

// ---------- SFX ----------
function blip({ freq = 440, freqEnd = null, dur = 0.12, type = 'sine', vol = 0.25, delay = 0 }) {
  if (!state.sfxEnabled) return;
  const ctx = ensureCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(state.sfxGain);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  click() {
    blip({ freq: 660, freqEnd: 520, dur: 0.07, type: 'square', vol: 0.08 });
  },
  levelup() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      blip({ freq: f, dur: 0.22, type: 'triangle', vol: 0.2, delay: i * 0.11 })
    );
  },
  raredrop() {
    // shimmering rise + sparkle
    blip({ freq: 300, freqEnd: 1800, dur: 0.9, type: 'sawtooth', vol: 0.06 });
    [1318.5, 1568, 2093, 2637].forEach((f, i) =>
      blip({ freq: f, dur: 0.5, type: 'sine', vol: 0.12, delay: 0.5 + i * 0.09 })
    );
  },
  purchase() {
    blip({ freq: 988, dur: 0.1, type: 'sine', vol: 0.2 });
    blip({ freq: 1319, dur: 0.18, type: 'sine', vol: 0.2, delay: 0.09 });
  },
  upgrade() {
    blip({ freq: 220, freqEnd: 880, dur: 0.4, type: 'triangle', vol: 0.2 });
    blip({ freq: 1760, dur: 0.3, type: 'sine', vol: 0.1, delay: 0.35 });
  },
  error() {
    blip({ freq: 160, freqEnd: 110, dur: 0.25, type: 'square', vol: 0.1 });
  },
  reveal() {
    blip({ freq: 440, freqEnd: 660, dur: 0.5, type: 'sine', vol: 0.12 });
    blip({ freq: 880, dur: 0.4, type: 'sine', vol: 0.1, delay: 0.25 });
  },
};
