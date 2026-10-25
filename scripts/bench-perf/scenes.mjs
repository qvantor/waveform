// the cases of the perf suite (README.md) as data: a snapshot of the synth (the format of getSnapshot(), the
// sections left out are the defaults) and the notes held through it (window.__waveformPerf.run); the runner
// opens a fresh page for each run. What doesn't need a browser is computed in the Jest specs (README: what
// moved to the specs)

// the tables the cases play (S3 keys, 256 frames each)
export const TABLES = {
  saw303: 'ESW Core Tables/Analog/ESW Analog - 303 Saw.wav',
  pwm: 'ESW Core Tables/Basics/ESW Basics - PWM Saw 01.wav',
  // the default of the app: an oscillator that is off still loads it
  saws: 'ESW Core Tables/Basics/ESW Basics - Saw Collection.wav',
};

// the path of a table in the list of the app: its folders, then its key
const tablePath = (key) => [...key.split('/').slice(0, -1), key];

const osc = (key, values = {}) => ({
  a: true,
  p: tablePath(key),
  w: 128,
  u: 1,
  d: 0,
  o: 0,
  g: 0.5,
  ph: 0.5,
  pr: 1,
  ...values,
});
const OFF = { a: false };
const FILTER = { a: true, t: 'lowpass', cut: 2500, res: 6 };
const NO_FILTER = { a: false };
const ADSR = { attack: 0.01, hold: 0.1, decay: 0.3, sustain: 0.8, release: 0.3 };
// a sharp onset for the latency cases: no attack, every unison voice at its phase
const SHARP = { attack: 0, hold: 0.1, decay: 0, sustain: 1, release: 0.05 };
const VOICING = { leg: false, port: 0, max: 12 };

const fx = (added = []) => ({
  o: ['distortion', 'delay', 'reverb'],
  distortion: { a: added.includes('distortion'), on: true, mix: 1, drive: 8, mode: 0 },
  delay: { a: added.includes('delay'), on: true, mix: 0.3, time: 0.3, fb: 0.5 },
  reverb: { a: added.includes('reverb'), on: true, mix: 0.3, decay: 3 },
});

// the velocity takes nothing of the volume (Amp 0): no amp on the voices, the work of a tree before the velocity
// (an A/B run against one compares the same work; a tree before it leaves `vel` out)
const NO_VELOCITY = { amp: 0 };

const patch = (values = {}) => ({
  osc1: osc(TABLES.saw303),
  osc2: OFF,
  filter: NO_FILTER,
  v: VOICING,
  fx: fx(),
  ...values,
  env: { e1: ADSR, ...values.env, vel: NO_VELOCITY },
});

const BOTH_U8 = {
  osc1: osc(TABLES.saw303, { u: 8, d: 25 }),
  osc2: osc(TABLES.pwm, { u: 8, d: 35, o: -1, w: 64 }),
};
// the heavy patch (measured on the iPhone): 2 oscillators × u8 on two tables of 256 frames, the filter, every
// effect, Poly 12
const HEAVY = patch({ ...BOTH_U8, filter: FILTER, fx: fx(['distortion', 'delay', 'reverb']) });

// --- CPU and memory: the notes are held, xctrace records 10 s after a warm-up ---

export const CPU_CASES = [
  {
    id: 'S5',
    group: 'cpu',
    title: 'the heavy patch, 12 notes',
    snapshot: HEAVY,
    notes: ['C3', 'D3', 'E3', 'G3', 'A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'B4', 'C5'],
  },
];

// --- latency: real input, one run each (README: latency) ---

// keys of the QWERTY keyboard of the app and their notes (keyboard-controller.ts)
export const KEYS = [
  ['KeyQ', 'C4'],
  ['KeyW', 'D4'],
  ['KeyE', 'E4'],
  ['KeyR', 'F4'],
  ['KeyT', 'G4'],
  ['KeyY', 'A4'],
  ['KeyU', 'B4'],
  ['KeyI', 'C5'],
];

const SHARP_PATCH = patch({ osc1: osc(TABLES.saw303, { pr: 0 }), env: { e1: SHARP } });

export const LATENCY_CASES = [
  {
    id: 'L1',
    group: 'latency',
    title: 'single notes, a key every 300 ms',
    snapshot: SHARP_PATCH,
    count: 50,
    interval: 300,
    probe: true,
  },
  {
    id: 'L3',
    group: 'latency',
    title: '8 notes held (2 × u8), single notes on top',
    snapshot: patch({ ...BOTH_U8, env: { e1: SHARP } }),
    count: 50,
    interval: 300,
    held: ['C2', 'E2', 'G2', 'B2', 'C3', 'E3', 'G3', 'B3'],
  },
];

// the cases of a run: all of them, or those --only names (ids, or the groups cpu and latency)
export const selectCases = ({ only }) => {
  const all = [...CPU_CASES, ...LATENCY_CASES];
  if (!only) return all;
  const wanted = only.split(',');
  return all.filter((kase) => wanted.includes(kase.id) || wanted.includes(kase.group));
};
