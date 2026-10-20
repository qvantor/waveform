// the renders of an Audio Unit (manual: macOS, the RENDERS_* of .env; `node scripts/renders/run.mjs`):
// host.swift, an offline host of its AU (AVAudioEngine, manual rendering), renders notes of its init patch with
// parameters set, the measurements of them go to dsp/measurements, which the specs compare the engine with
// (no Audio Unit in CI):
// - envelopes.json: the level of ENV 1 every 10 ms of an attack, a decay (to -12 dB) and a release of 1 s each, at
//   the curves 25, 50, 66.6 (the default of the decay and the release) and 75%: the render over the one of a flat
//   envelope at the same phase (Rand Phase 0), so the wave cancels out
// - unison.json: the voices of a unison of C5 (their cents from the note, their level in each channel against one
//   voice) at 2..7 voices, its Blend, Width and Detune
// Its knobs are 0..1: the times are 32 s · v⁵, the sustain v² (-12 dB at 0.5), the voices 1 + 15v
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readEnv } from '../bench-common.mjs';

const require = createRequire(import.meta.url);
const FFT = require('fft.js');
const root = new URL('../..', import.meta.url).pathname;
// the Audio Unit of the stand and its tables: the RENDERS_* of .env
readEnv();
const work = join(root, 'tmp/renders');
const out = join(root, 'dsp/measurements');
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });
const RATE = 48000;

const host = join(work, 'host');
execFileSync('swiftc', ['-O', join(root, 'scripts/renders/host.swift'), '-o', host], { stdio: 'inherit' });

// a job of the host: its stereo output, channel by channel
const render = (name, params, notes, seconds) => {
  const job = join(work, `${name}.json`);
  const file = join(work, `${name}.f32`);
  writeFileSync(job, JSON.stringify({ rate: RATE, seconds, params, notes }));
  const { status, stderr } = spawnSync(host, ['render', job, file], { timeout: 300000 });
  if (status !== 0) throw new Error(`the host failed on ${name}: ${stderr}`);
  const bytes = readFileSync(file);
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  return [0, 1].map((channel) => samples.filter((_, i) => i % 2 === channel));
};

// --- envelopes ---
const ON = 0.1;
const OFF = 2.6;
const flat = { 'A Rand Phase': 0, 'A Phase': 0 };
const [reference] = render(
  'ref',
  { ...flat, 'Env 1 Attack': 0, 'Env 1 Hold': 0, 'Env 1 Decay': 0, 'Env 1 Sustain': 1, 'Env 1 Release': 0 },
  [{ note: 60, on: ON, off: 4.4 }],
  4.5
);
let loudest = 0;
for (let i = 0.2 * RATE; i < 0.4 * RATE; i++) loudest = Math.max(loudest, Math.abs(reference[i]));
// the level every 10 ms from `from` (s) for `seconds`: the median of render / reference where it is loud
const levels = (left, from, seconds) =>
  Array.from({ length: Math.round(seconds * 100) + 1 }, (_, k) => {
    const start = Math.round((from + k / 100) * RATE);
    const ratios = [];
    for (let i = start; i < start + 480; i++)
      if (Math.abs(reference[i]) > 0.3 * loudest) ratios.push(left[i] / reference[i]);
    ratios.sort((a, b) => a - b);
    return Number(ratios[ratios.length >> 1].toFixed(5));
  });
const curves = {};
for (const curve of [0.25, 0.5, 0.666, 0.75]) {
  const [left] = render(
    `curve-${curve}`,
    {
      ...flat,
      'Env 1 Attack': 0.5,
      'Env 1 Hold': 0,
      'Env 1 Decay': 0.5,
      'Env 1 Sustain': 0.5,
      'Env 1 Release': 0.5,
      'Env 1 Atk Curve': curve,
      'Env 1 Dec Curve': curve,
      'Env 1 Rel Curve': curve,
    },
    [{ note: 60, on: ON, off: OFF }],
    4.5
  );
  curves[curve] = {
    attack: levels(left, ON, 1),
    decay: levels(left, ON + 1, 1),
    release: levels(left, OFF, 1),
  };
}
writeFileSync(
  join(out, 'envelopes.json'),
  `${JSON.stringify(
    {
      about:
        'ENV 1 of the init patch of the Audio Unit: attack, decay and release of 1 s, the sustain at -12 dB (0.25); the level every 10 ms (the median of a window of 10 ms from there) of each stage, by its curve (0..1, 0.5 the attack and 0.666 the decay and the release by default); scripts/renders/run.mjs',
      sustain: 0.25,
      curves,
    },
    null,
    1
  )}\n`
);

// --- unison ---
const NOTE = 72;
const F0 = 440 * 2 ** ((NOTE - 69) / 12);
const N = 1 << 18;
const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
const spectrum = (x) => {
  const fft = new FFT(N);
  const bins = fft.createComplexArray();
  fft.realTransform(
    bins,
    Array.from({ length: N }, (_, i) => x[i + 9600] * hann[i])
  );
  return Float64Array.from({ length: N / 2 }, (_, k) => Math.hypot(bins[2 * k], bins[2 * k + 1]) / (N / 4));
};
// the voices around the fundamental: their cents and their amplitude in each channel (the main lobe of a Hann)
const voices = (channels) => {
  const [l, r] = channels.map(spectrum);
  const bin = (cents) => (F0 * 2 ** (cents / 1200) * N) / RATE;
  const peaks = [];
  for (let k = Math.floor(bin(-260)) + 1; k < Math.ceil(bin(260)); k++) {
    const m = l[k] + r[k];
    if (m > l[k - 1] + r[k - 1] && m >= l[k + 1] + r[k + 1] && m > 0.0005) {
      const amplitude = (s) => Math.hypot(s[k - 1], s[k], s[k + 1]);
      peaks.push({ cents: 1200 * Math.log2((k * RATE) / N / F0), left: amplitude(l), right: amplitude(r) });
    }
  }
  return peaks;
};
const unison = (name, count, params = {}) =>
  voices(
    render(
      name,
      { 'A Rand Phase': 0, 'Env 1 Attack': 0, 'Env 1 Sustain': 1, 'A Unison': (count - 1) / 15, ...params },
      [{ note: NOTE, on: 0, off: 6 }],
      6
    )
  );
const [one] = unison('u1', 1);
const db = (amplitude) =>
  amplitude > 1e-6 ? Number((20 * Math.log10(amplitude / one.left)).toFixed(1)) : null;
const table = (peaks) =>
  peaks.map(({ cents, left, right }) => ({
    cents: Number(cents.toFixed(1)),
    left: db(left),
    right: db(right),
  }));
const cases = {};
for (const count of [2, 3, 4, 5, 7])
  cases[`u${count}`] = table(unison(`u${count}`, count, { 'A Uni Detune': 1 }));
for (const blend of [0, 0.25, 0.5, 1])
  for (const count of [4, 5])
    cases[`u${count} blend ${blend}`] = table(
      unison(`u${count}-blend${blend}`, count, { 'A Uni Detune': 1, 'A Uni Blend': blend })
    );
for (const width of [0.5, 0.75])
  cases[`u5 width ${width}`] = table(
    unison(`u5-width${width}`, 5, { 'A Uni Detune': 1, 'A Uni Width': width })
  );
for (const detune of [0.25, 0.5, 0.75])
  cases[`u5 detune ${detune}`] = table(unison(`u5-detune${detune}`, 5, { 'A Uni Detune': detune }));
writeFileSync(
  join(out, 'unison.json'),
  `${JSON.stringify(
    {
      about:
        'Osc A of the init patch of the Audio Unit at C5 with a unison (Blend 0.75, Width 1, Detune 1 unless named): each voice its cents from the note and its level in each channel (dB against a single voice, null: not heard); scripts/renders/run.mjs',
      cases,
    },
    null,
    1
  )}\n`
);
console.log(`dsp/measurements: ${Object.keys(curves).length} curves, ${Object.keys(cases).length} unisons`);
