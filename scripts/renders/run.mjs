// the renders of an Audio Unit (manual: macOS, the RENDERS_* of .env; `node scripts/renders/run.mjs`):
// host.swift, an offline host of its AU (AVAudioEngine, manual rendering), renders notes of its init patch with
// parameters set, the measurements of them go to dsp/measurements, which the specs compare the engine with
// (no Audio Unit in CI):
// - envelopes.json: the level of ENV 1 every 10 ms of an attack, a decay (to -12 dB) and a release of 1 s each, at
//   the curves 25, 50, 66.6 (the default of the decay and the release) and 75%: the render over the one of a flat
//   envelope at the same phase (Rand Phase 0), so the wave cancels out
// - unison.json: the voices of a unison of C5 (their cents from the note, their level in each channel against one
//   voice) at 2..7 voices, its Blend, Width and Detune
// - frames.json: tables of ours (state.mjs: written into User of its tables, removed after), frame j a
//   sine of harmonic j + 1: the frame a position plays, how a table with a morph mark is expanded to 256 frames
//   (the shares of the source frames in each), the morph marks 1..4 on frames of other phases
// Its knobs are 0..1: the times are 32 s · v⁵, the sustain v² (-12 dB at 0.5), the voices 1 + 15v.
// `--only=envelopes,unison,frames` renders some of them
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readEnv } from '../bench-common.mjs';
import { stateWithTable, tables, writeTable } from './state.mjs';

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
const only = process.argv
  .find((arg) => arg.startsWith('--only='))
  ?.slice(7)
  .split(',');
const runs = (part) => !only || only.includes(part);

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
if (runs('envelopes')) {
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
}

// --- unison ---
if (runs('unison')) {
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
  console.log(`dsp/measurements: ${Object.keys(cases).length} unisons`);
}

// --- frames ---
if (runs('frames')) {
  const FRAMES_NOTE = 36;
  const FRAMES_F0 = 440 * 2 ** ((FRAMES_NOTE - 69) / 12);
  const init = join(work, 'init-state.bin');
  execFileSync(host, ['state', init]);
  // a job of the host in a pool (each one a process): its left channel
  let running = 0;
  const waiting = [];
  const renderAsync = (name, state, params) =>
    new Promise((resolve, reject) => {
      const start = () => {
        running++;
        const job = join(work, `${name}.json`);
        const file = join(work, `${name}.f32`);
        writeFileSync(
          job,
          JSON.stringify({
            rate: RATE,
            seconds: 0.5,
            state,
            params: { 'A Rand Phase': 0, 'A Phase': 0, 'Env 1 Attack': 0, 'Env 1 Sustain': 1, ...params },
            notes: [{ note: FRAMES_NOTE, on: 0, off: 0.5 }],
          })
        );
        spawn(host, ['render', job, file]).on('exit', (code) => {
          running--;
          waiting.shift()?.();
          if (code !== 0) return reject(new Error(`the host failed on ${name}`));
          const bytes = readFileSync(file);
          const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
          resolve(samples.filter((_, i) => i % 2 === 0));
        });
      };
      if (running < 8) start();
      else waiting.push(start);
    });
  // the complex amplitude of harmonic h over 0.15..0.45 s (Hann), its phase against a sine from the note on
  const harmonic = (x, h) => {
    const from = Math.round(0.15 * RATE);
    const n = Math.round(0.3 * RATE);
    let re = 0;
    let im = 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const phase = (2 * Math.PI * FRAMES_F0 * h * (from + i)) / RATE;
      re += x[from + i] * w * Math.sin(phase);
      im += x[from + i] * w * Math.cos(phase);
      sum += w;
    }
    return { amplitude: (2 * Math.hypot(re, im)) / sum, phase: (Math.atan2(im, re) * 180) / Math.PI };
  };
  const sine = (h) => Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * h * i) / 2048));
  const written = [];
  // a table of `count` frames (frame j: harmonic j + 1, unless `frames`) with its mark, and its state
  const tableState = (name, count, flags, frames = Array.from({ length: count }, (_, j) => sine(j + 1))) => {
    const file = join(tables(), 'User', `waveform-test-${name}.wav`);
    writeTable(file, frames, flags);
    written.push(file);
    const state = join(work, `state-${name}.bin`);
    writeFileSync(state, stateWithTable(init, `User/waveform-test-${name}.wav`, count));
    return state;
  };
  // the shares of the source frames (the amplitudes of their harmonics, summing to 1) at a position
  const shares = async (name, state, count, position) => {
    const x = await renderAsync(name, state, { 'A WT Pos': position });
    const amplitudes = Array.from({ length: count }, (_, j) => harmonic(x, j + 1).amplitude);
    const total = amplitudes.reduce((a, b) => a + b, 0);
    return amplitudes.map((a) => a / total);
  };
  const lower = (row) => row.findIndex((share) => share > 0.0005);
  try {
    // the frame a position plays: just below and above k / N (no mark)
    const played = {};
    for (const count of [3, 4]) {
      const state = tableState(`plain-${count}`, count, '00000000');
      const edges = Array.from({ length: count - 1 }, (_, i) => i + 1);
      played[count] = await Promise.all(
        edges.map(async (k) => {
          const [below, above] = await Promise.all(
            [k / count - 1e-4, k / count + 1e-4].map((v, i) =>
              shares(`plain-${count}-${k}-${i}`, state, count, v)
            )
          );
          return { edge: k / count, below: lower(below), above: lower(above) };
        })
      );
    }
    // the expanded frames of a table with a morph mark: the source frame below and the share of the next one
    const morphed = {};
    for (const count of [3, 4, 16]) {
      const state = tableState(`morph-${count}`, count, '10000000');
      morphed[count] = await Promise.all(
        Array.from({ length: 256 }, async (_, e) => {
          const row = await shares(`morph-${count}-${e}`, state, count, (e + 0.5) / 256);
          const j = lower(row);
          return [j, Number((row[j + 1] ?? 0).toFixed(5))];
        })
      );
    }
    // the marks 1..4 (crossfade, spectral, spectral without the phase of the fundamental, without any phases) and
    // 01 on 2 frames of other phases: h1 1 at 0°, h2 0.5 at 0°; h1 0.5 at 120°, h2 1 at -90°; at e = 128
    const frame = (parts) =>
      Array.from({ length: 2048 }, (_, i) =>
        parts.reduce(
          (sum, [h, a, p]) => sum + a * Math.sin((2 * Math.PI * h * i) / 2048 + (p * Math.PI) / 180),
          0
        )
      );
    const pair = [
      frame([
        [1, 1, 0],
        [2, 0.5, 0],
      ]),
      frame([
        [1, 0.5, 120],
        [2, 1, -90],
      ]),
    ];
    const marks = {};
    for (const mark of ['00000000', '01000000', '10000000', '20000000', '30000000', '40000000']) {
      const state = tableState(`mark-${mark.slice(0, 2)}`, 2, mark, pair);
      const [first, middle] = await Promise.all(
        [0.5 / 256, 128.5 / 256].map((v, i) => renderAsync(`mark-${mark}-${i}`, state, { 'A WT Pos': v }))
      );
      const at = (x) => [1, 2].map((h) => harmonic(x, h));
      const [r1, r2] = at(first);
      const [m1, m2] = at(middle);
      const relative = (c, r) => ({
        amplitude: Number((c.amplitude / r1.amplitude).toFixed(4)),
        phase: Number((((c.phase - r.phase + 540) % 360) - 180).toFixed(2)),
      });
      marks[mark] = { h1: relative(m1, r1), h2: relative(m2, r2) };
    }
    writeFileSync(
      join(out, 'frames.json'),
      `${JSON.stringify(
        {
          about:
            'Osc A of the init patch of the Audio Unit playing tables of ours (frame j a sine of harmonic j + 1; the state of its Audio Unit with the path of its table swapped): `played` the source frame just below and above each edge k / N of the position (no mark), `morphed` for each of the 256 frames a table with the mark 1 expands to (at the position (e + 0.5) / 256) the source frame below and the share of the next one, `marks` the harmonics 1 and 2 at e = 128 of 2 frames (h1 1 at 0°, h2 0.5 at 0°; h1 0.5 at 120°, h2 1 at -90°) against frame 0, by mark; scripts/renders/run.mjs',
          played,
          morphed,
          marks,
        },
        null,
        1
      )}\n`
    );
    console.log(`dsp/measurements: frames of ${Object.keys(morphed).length} morphed tables`);
  } finally {
    written.forEach((file) => rmSync(file, { force: true }));
  }
}
