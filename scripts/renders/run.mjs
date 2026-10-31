// the renders of an Audio Unit (manual: macOS, the RENDERS_* of .env; `node scripts/renders/run.mjs`):
// host.swift, an offline host of its AU (AVAudioEngine, manual rendering), renders notes of its init patch with
// parameters set, the measurements of them go to dsp/measurements, which the specs compare the engine with
// (no Audio Unit in CI):
// - envelopes.json: the level of ENV 1 every 10 ms of an attack, a decay (to -12 dB) and a release of 1 s each, at
//   the curves 25, 50, 66.6 (the default of the decay and the release) and 75%: the render over the one of a flat
//   envelope at the same phase (Rand Phase 0), so the wave cancels out
// - unison.json: the voices of a unison of C5 (their cents from the note, their level in each channel against one
//   voice) at 2..7 voices, its Blend, Width and Detune
// - phases.json: osc A and B on one sine, their unisons and Rand Phase: which of their voices start in phase
// - frames.json: tables of ours (state.mjs: written into User of its tables, removed after), frame j a
//   sine of harmonic j + 1: the frame a position plays, how a table with a morph mark is expanded to 256 frames
//   (the shares of the source frames in each), the morph marks 1..4 on frames of other phases
// - frame-fades.json: how a moving position (A WT Pos automated by host.swift) goes from one frame to another:
//   the length of the fade by note and rate, sweeps, two unison voices, a pitch bend during a fade
// - aliasing.json: the sound criteria of the oscillator benchmark (scripts/bench-osc: its tables, pitches and rates,
//   the frame it compares as a table of one frame), which it checks ours against
// Its knobs are 0..1: the times are 32 s · v⁵, the sustain v² (-12 dB at 0.5), the voices 1 + 15v.
// `--only=envelopes,unison,unison-modes,phases,frames,frame-fades,aliasing` renders some of them
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { downloadTables, fileName, readEnv } from '../bench-common.mjs';
import { analyze, frameOf, PITCHES, sawFrame, SIZE, TABLES } from '../bench-osc/sound.mjs';
import { editedState, tables, writeTable } from './state.mjs';

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

// a job of the host in a pool of 8 processes: its stereo output, channel by channel
let running = 0;
const waiting = [];
const hostRender = (name, job) =>
  new Promise((resolve, reject) => {
    const start = () => {
      running++;
      const file = join(work, `${name}.json`);
      const output = join(work, `${name}.f32`);
      writeFileSync(file, JSON.stringify({ rate: RATE, ...job }));
      spawn(host, ['render', file, output]).on('exit', (code) => {
        running--;
        waiting.shift()?.();
        if (code !== 0) return reject(new Error(`the host failed on ${name}`));
        const bytes = readFileSync(output);
        const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
        resolve([0, 1].map((channel) => samples.filter((_, i) => i % 2 === channel)));
      });
    };
    if (running < 8) start();
    else waiting.push(start);
  });
const init = join(work, 'init-state.bin');
execFileSync(host, ['state', init]);

// osc A of the init patch at the phase 0 of every voice, ENV 1 open
const FLAT = { 'A Rand Phase': 0, 'A Phase': 0, 'Env 1 Attack': 0, 'Env 1 Sustain': 1 };
// a table of ours (frames of 2048 samples, its mark) written into User of the tables of the Audio Unit, and the
// init state with its first `oscs` oscillators on it (A alone by default); `removeTables` removes them
const written = [];
const tableState = (name, frames, flags = '00000000', oscs = 1) => {
  const file = join(tables(), 'User', `waveform-test-${name}.wav`);
  writeTable(file, frames, flags);
  written.push(file);
  const state = join(work, `state-${name}.bin`);
  const path = `User/waveform-test-${name}.wav`;
  writeFileSync(
    state,
    editedState(
      init,
      Array.from({ length: oscs }, () => ({ path, frames: frames.length }))
    )
  );
  return state;
};
const removeTables = () => written.splice(0).forEach((file) => rmSync(file, { force: true }));
// a frame of 2048 samples: a sine of harmonic h (-1: inverted)
const sine = (h = 1) => Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * h * i) / 2048));
// the middle value (the upper one of an even count)
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

// the magnitude spectrum of 2^18 samples from 0.2 s (Hann), the amplitude of a sine at its peak
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
// the complex amplitude of a tone of `frequency` in x over n samples from `from` (Hann): its amplitude and its
// phase (degrees) against a sine from sample 0
const tone = (x, frequency, from, n) => {
  let re = 0;
  let im = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const phase = (2 * Math.PI * frequency * (from + i)) / RATE;
    re += x[from + i] * w * Math.sin(phase);
    im += x[from + i] * w * Math.cos(phase);
    sum += w;
  }
  return { amplitude: (2 * Math.hypot(re, im)) / sum, phase: (Math.atan2(im, re) * 180) / Math.PI };
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
      return Number(median(ratios).toFixed(5));
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

// --- unison modes ---
// the detune modes (kParamDetuneMode of the plain params of osc A: no parameter of the AU sets it) and the stacks
// (A Uni Stack, 9 values: floor(v·9)) of a unison of a sine (a table of ours: its harmonics would hide the
// stacked voices), merged into unison.json: each voice its cents (modes, Detune 1: ±200), and its semitones of
// the stack, its cents of the detune and its side (stacks, Detune 0.5: ±35 cents)
if (runs('unison-modes')) {
  const table = join(tables(), 'User', 'waveform-test-sine.wav');
  writeTable(table, [sine()], '00000000');
  const C4 = 440 * 2 ** ((60 - 69) / 12);
  const stateOf = (name, params) => {
    const file = join(work, `state-${name}.bin`);
    writeFileSync(file, editedState(init, [{ path: 'User/waveform-test-sine.wav', frames: 1, params }]));
    return file;
  };
  // the peaks from `low` to `high` cents of C4, the cents refined by the parabola of their three bins
  const peaks = (channels, low, high) => {
    const [l, r] = channels.map(spectrum);
    const bin = (cents) => (C4 * 2 ** (cents / 1200) * N) / RATE;
    const found = [];
    for (let k = Math.floor(bin(low)) + 1; k < Math.ceil(bin(high)); k++) {
      const [y0, y1, y2] = [l[k - 1] + r[k - 1], l[k] + r[k], l[k + 1] + r[k + 1]];
      if (y1 > y0 && y1 >= y2 && y1 > 0.001) {
        const d = (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2);
        const amplitude = (s) => Math.hypot(s[k - 1], s[k], s[k + 1]);
        found.push({
          cents: 1200 * Math.log2(((k + d) * RATE) / N / C4),
          left: amplitude(l),
          right: amplitude(r),
        });
      }
    }
    return found;
  };
  const note = (name, state, params) =>
    hostRender(name, {
      seconds: 6.5,
      state,
      params: { 'A Rand Phase': 0, 'Env 1 Attack': 0, 'Env 1 Sustain': 1, ...params },
      notes: [{ note: 60, on: 0, off: 6.5 }],
    });
  const modes = {};
  const stacks = {};
  const STACKS = [
    'off',
    '12 (1x)',
    '12 (2x)',
    '12 (3x)',
    '12+7 (1x)',
    '12+7 (2x)',
    '12+7 (3x)',
    'Center-12',
    'Center-24',
  ];
  const STEPS = [-24, -12, 0, 7, 12, 19, 24, 31, 36];
  try {
    const jobs = [];
    for (const mode of ['kDetuneLinear', 'kDetuneSuper', 'kDetuneExp', 'kDetuneInv']) {
      const state = stateOf(mode, { kParamDetuneMode: mode });
      for (const count of [3, 4, 5, 6, 7, 8, 9, 10, 12, 16])
        jobs.push(
          note(`${mode}-${count}`, state, { 'A Unison': (count - 1) / 15, 'A Uni Detune': 1 }).then((x) => {
            modes[`${mode.slice(7).toLowerCase()} u${count}`] = peaks(x, -300, 300).map((p) =>
              Number(p.cents.toFixed(2))
            );
          })
        );
    }
    const linear = stateOf('linear', { kParamDetuneMode: 'kDetuneLinear' });
    STACKS.forEach((name, i) => {
      for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 16])
        jobs.push(
          note(`stack-${i}-${count}`, linear, {
            'A Unison': (count - 1) / 15,
            'A Uni Detune': 0.5,
            'A Uni Stack': (i + 0.5) / 9,
          }).then((x) => {
            stacks[`${name} u${count}`] = peaks(x, -2500, 4000)
              .map(({ cents, left, right }) => {
                const st = cents / 100;
                const step = STEPS.reduce((a, b) => (Math.abs(st - b) < Math.abs(st - a) ? b : a));
                const side = left > 2 * right ? 'L' : right > 2 * left ? 'R' : 'C';
                return { step, detune: Math.round((st - step) * 100), side };
              })
              .sort((a, b) => a.detune - b.detune);
          })
        );
    });
    await Promise.all(jobs);
  } finally {
    rmSync(table, { force: true });
  }
  const file = join(out, 'unison.json');
  const unison = JSON.parse(readFileSync(file, 'utf8'));
  const sorted = (o) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        ...unison,
        about_modes:
          'Osc A of the Audio Unit on a sine (a table of ours) at C4: `modes` the cents of each voice by detune mode (kParamDetuneMode of its state) at Detune 1 and 3..16 voices; `stacks` each voice by A Uni Stack at Detune 0.5 and 1..16 voices: the semitones of its stack, its detune (cents) and its side (L, R, C both); scripts/renders/run.mjs --only=unison-modes',
        modes: sorted(modes),
        stacks: sorted(stacks),
      },
      null,
      1
    )}\n`
  );
  console.log(
    `dsp/measurements: ${Object.keys(modes).length} detune modes, ${Object.keys(stacks).length} stacks`
  );
}

// --- phases ---
// the start phases of osc A and B on one sine (a table of ours) at C5, their unisons at Detune 1 (linear: voice j
// of n at 200 · (2j / (n - 1) - 1) cents): each pair of voices of A and B at one pitch, on each of 12 notes, the
// amplitude of the pair over the sum of those of its voices alone. The first 4 notes of a render are left out:
// they start at about the Phase whatever the Rand Phase (the random draws of the AU start near 0)
if (runs('phases')) {
  const NOTE = 72;
  const C5 = 440 * 2 ** ((NOTE - 69) / 12);
  const SKIPPED = 4;
  const NOTES = Array.from({ length: SKIPPED + 12 }, (_, k) => ({
    note: NOTE,
    on: 0.1 + 0.6 * k,
    off: 0.6 + 0.6 * k,
  }));
  const MEASURED = NOTES.slice(SKIPPED);
  const cents = (j, n) => (n === 1 ? 0 : 200 * ((2 * j) / (n - 1) - 1));
  // the amplitude of a tone of `cents` from C5 in x over 0.05..0.45 s of a note
  const amplitude = (x, c, on) =>
    tone(x, C5 * 2 ** (c / 1200), Math.round((on + 0.05) * RATE), Math.round(0.4 * RATE)).amplitude;
  // an oscillator of a case: its unison, Rand Phase and Phase (shares of a period)
  const osc = ({ unison = 1, rand = 1, phase = 0.5 }) => ({ unison, rand, phase });
  const oscParams = (side, { unison, rand, phase }) => ({
    [`${side} Unison`]: (unison - 1) / 15,
    [`${side} Uni Detune`]: 1,
    [`${side} Rand Phase`]: rand,
    [`${side} Phase`]: phase,
  });
  const CASES = Object.entries({
    u1: [{}, {}],
    u2: [{ unison: 2 }, { unison: 2 }],
    u3: [{ unison: 3 }, { unison: 3 }],
    u4: [{ unison: 4 }, { unison: 4 }],
    'u3 + u2': [{ unison: 3 }, { unison: 2 }],
    'u1 + u3': [{}, { unison: 3 }],
    'u1, B Rand Phase 0': [{}, { rand: 0 }],
    'u1, B Rand Phase 0.5': [{}, { rand: 0.5 }],
    'u1, Rand Phase 0.5': [{ rand: 0.5 }, { rand: 0.5 }],
    'u1, B Phase 0.25': [{}, { phase: 0.25 }],
  }).map(([name, oscs]) => [name, oscs.map(osc)]);
  const UNISONS = [...new Set(CASES.flatMap(([, oscs]) => oscs.map(({ unison }) => unison)))];
  const state = tableState('phases', [sine()], '00000000', 2);
  // the notes in L + R
  const notes = async (name, params) => {
    const [l, r] = await hostRender(name, {
      seconds: 0.1 + 0.6 * NOTES.length,
      state,
      params: { 'Env 1 Attack': 0, 'Env 1 Sustain': 1, 'Env 1 Release': 0, ...params },
      notes: NOTES,
    });
    return Float64Array.from(l, (value, i) => value + r[i]);
  };
  const [alone, rendered] = await Promise.all([
    // osc A alone at each unison (B plays as A)
    Promise.all(
      UNISONS.map((n) =>
        notes(`phases-alone-u${n}`, { 'B Enable': 0, ...oscParams('A', osc({ unison: n })) })
      )
    ),
    Promise.all(
      CASES.map(([name, [a, b]]) =>
        notes(`phases-${name.replace(/\W+/g, '-')}`, {
          'B Enable': 1,
          ...oscParams('A', a),
          ...oscParams('B', b),
        })
      )
    ),
  ]).finally(removeTables);
  // the amplitude of each voice of a unison alone (by the unison): the median over the notes
  const aloneOf = Object.fromEntries(
    UNISONS.map((n, i) => [
      n,
      Array.from({ length: n }, (_, j) =>
        median(MEASURED.map(({ on }) => amplitude(alone[i], cents(j, n), on)))
      ),
    ])
  );
  const cases = CASES.map(([name, [a, b]], c) => {
    const [m, n] = [a.unison, b.unison];
    const pairs = [];
    for (let j = 0; j < m; j++)
      for (let k = 0; k < n; k++) {
        const pitch = cents(j, m);
        if (Math.abs(pitch - cents(k, n)) < 1) {
          const sum = aloneOf[m][j] + aloneOf[n][k];
          pairs.push({
            a: j,
            b: k,
            cents: Number(pitch.toFixed(1)),
            levels: MEASURED.map(({ on }) => Number((amplitude(rendered[c], pitch, on) / sum).toFixed(3))),
          });
        }
      }
    return [name, { a, b, pairs }];
  });
  writeFileSync(
    join(out, 'phases.json'),
    `${JSON.stringify(
      {
        about:
          'Osc A and B of the init patch of the Audio Unit on a sine (a table of ours) at C5, each its unison at Detune 1 (linear: voice j of n at 200 · (2j / (n - 1) - 1) cents, from the lowest), its Rand Phase (`rand`) and Phase (`phase`, shares of a period; 1 and 0.5 unless named), the same Level: on each of 12 notes (0.5 s long; the 4 before them of the render left out, they start at about the Phase whatever the Rand Phase) each pair of voices of A (`a`) and B (`b`) at one pitch, the amplitude of the pair in L + R over the sum of those of its two voices alone (1: in phase; two of one level cancel at 0); scripts/renders/run.mjs --only=phases',
        cases: Object.fromEntries(cases),
      },
      null,
      1
    )}\n`
  );
  console.log(`dsp/measurements: phases of ${cases.length} pairs of oscillators`);
}

// --- frames ---
if (runs('frames')) {
  const FRAMES_NOTE = 36;
  const FRAMES_F0 = 440 * 2 ** ((FRAMES_NOTE - 69) / 12);
  // a note of osc A: its left channel
  const renderAsync = async (name, state, params) =>
    (
      await hostRender(name, {
        seconds: 0.5,
        state,
        params: { ...FLAT, ...params },
        notes: [{ note: FRAMES_NOTE, on: 0, off: 0.5 }],
      })
    )[0];
  // the complex amplitude of harmonic h over 0.15..0.45 s, its phase against a sine from the note on
  const harmonic = (x, h) => tone(x, FRAMES_F0 * h, Math.round(0.15 * RATE), Math.round(0.3 * RATE));
  // `count` frames, frame j a sine of harmonic j + 1
  const sines = (count) => Array.from({ length: count }, (_, j) => sine(j + 1));
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
      const state = tableState(`plain-${count}`, sines(count));
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
      const state = tableState(`morph-${count}`, sines(count), '10000000');
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
      const state = tableState(`mark-${mark.slice(0, 2)}`, pair, mark);
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
    removeTables();
  }
}

// --- frame fades ---
// how osc A goes from one frame to another while its position moves (A WT Pos automated, set every 16 samples):
// tables of ours of sines of one phase and the other (frame j: (-1)^j · a sine), so the sign of the output tells
// the frame, and between two frames x = (1 - 2m) · the sine, m the share of the new one
if (runs('frame-fades')) {
  const note = (name, job) => hostRender(name, { step: 16, ...job });
  // A WT Pos through its points [seconds, value]; a step from frame 0 to 1 of 2 frames at 0.5 s
  const wtPos = (...points) => ({ name: 'A WT Pos', points });
  const STEP = wtPos([0, 0.25], [0.5, 0.25], [0.5, 0.75]);
  // the sine of frequency f in x over [n0, n1): its amplitude and phase (`cents`: f refined within ±cents, by
  // 0.01; a note of the init patch is its frequency, an error of 0.1 cent would turn its phase 20° in 4 s)
  const fit = (x, rate, f, n0, n1, cents = 0) => {
    let best = null;
    for (let c = -cents; c <= cents + 1e-9; c += 0.01) {
      const w = (2 * Math.PI * f * 2 ** (c / 1200)) / rate;
      let a = 0;
      let b = 0;
      for (let n = n0; n < n1; n++) {
        a += x[n] * Math.cos(w * n);
        b += x[n] * Math.sin(w * n);
      }
      const amp = (2 * Math.hypot(a, b)) / (n1 - n0);
      if (!best || amp > best.amp) best = { w, amp, phi: Math.atan2(a, b) };
    }
    return best;
  };
  // x over that sine from n0 to n1 where it is not near 0 (|sin| above `low`): [n, x / the sine]
  const against = (x, s, n0, n1, low = 0.3) => {
    const out = [];
    for (let n = n0; n < n1; n++) {
      const sn = Math.sin(s.w * n + s.phi);
      if (Math.abs(sn) > low) out.push([n, x[n] / sn / s.amp]);
    }
    return out;
  };
  // the fade of the first change of a: the line of m = (1 - a) / 2 through 0.15..0.85 (its start where it is 0,
  // its length the samples to 1; `fadeOf` of wavetable-osc-dsp.spec.ts measures the engine so: keep them alike)
  const fadeOf = (a) => {
    const first = a.findIndex(([, v]) => v < 0.98);
    if (first < 0) throw new Error('fadeOf: no change of frame');
    const mid = [];
    for (let i = first; i < a.length && a[i][1] > -0.98; i++)
      if (a[i][1] < 0.7 && a[i][1] > -0.7) mid.push([a[i][0], (1 - a[i][1]) / 2]);
    if (mid.length < 2) throw new Error(`fadeOf: a step, not a fade (${mid.length} samples within ±0.7)`);
    const mx = mid.reduce((t, [n]) => t + n, 0) / mid.length;
    const my = mid.reduce((t, [, m]) => t + m, 0) / mid.length;
    const slope =
      mid.reduce((t, [n, m]) => t + (n - mx) * (m - my), 0) / mid.reduce((t, [n]) => t + (n - mx) ** 2, 0);
    const start = mx - my / slope;
    // the most a sample of it is off the line (a fade linear in time: within the noise of the fit)
    const off = Math.max(...mid.map(([n, m]) => Math.abs(m - (n - start) * slope)));
    return { start: Math.round(start), length: Number((1 / slope).toFixed(1)), off: Number(off.toFixed(3)) };
  };
  try {
    const flip = tableState('flip', [sine(1), sine(-1)]);
    // the step by note and rate: the start of the fade and its length
    const lengths = {};
    const jobs = [];
    for (const rate of [44100, 48000, 96000]) {
      lengths[rate] = [];
      for (const key of [33, 45, 57, 69, 81, 93]) {
        const f = 440 * 2 ** ((key - 69) / 12);
        jobs.push(
          note(`fade-${rate}-${key}`, {
            rate,
            seconds: 1,
            state: flip,
            params: FLAT,
            automation: [STEP],
            notes: [{ note: key, on: 0, off: 1 }],
          }).then(([left]) => {
            const s = fit(left, rate, f, Math.round(0.1 * rate), Math.round(0.4 * rate));
            const { start, length } = fadeOf(against(left, s, Math.round(0.45 * rate), left.length));
            lengths[rate].push({ note: key, period: Number((rate / f).toFixed(1)), start, length });
          })
        );
      }
    }
    // a sweep of 256 frames at 220 Hz over 4, 1 and 0.25 s from 0.3 s: every fade that passes 0 (|x / the sine|
    // below 0.5: between frames of the same sign there is none to see) where it starts (below 0.98), how long it
    // takes (back above 0.98), and the sign before and after it
    const alternate = tableState(
      'alternate',
      Array.from({ length: 256 }, (_, j) => sine(j % 2 ? -1 : 1))
    );
    const sweeps = {};
    for (const seconds of [4, 1, 0.25])
      jobs.push(
        note(`sweep-${seconds}`, {
          seconds: seconds + 0.6,
          state: alternate,
          params: FLAT,
          automation: [wtPos([0, 0], [0.3, 0], [0.3 + seconds, 1])],
          notes: [{ note: 57, on: 0, off: seconds + 0.6 }],
        }).then(([left]) => {
          const s = fit(left, RATE, 220, Math.round(0.05 * RATE), Math.round(0.25 * RATE));
          const a = against(left, s, Math.round(0.25 * RATE), left.length, 0.5);
          const changes = [];
          for (let i = 1; i < a.length; i++) {
            if (Math.abs(a[i][1]) > 0.98 || Math.abs(a[i - 1][1]) <= 0.98) continue;
            let j = i;
            let deepest = 1;
            for (; j < a.length && Math.abs(a[j][1]) <= 0.98; j++)
              deepest = Math.min(deepest, Math.abs(a[j][1]));
            if (j === a.length) break;
            if (deepest < 0.5)
              changes.push([a[i][0], a[j][0] - a[i][0], Math.sign(a[i - 1][1]), Math.sign(a[j][1])]);
            i = j;
          }
          sweeps[seconds] = { changes };
        })
      );
    // two voices (A Unison 2: one right, one left): at Detune 1 (±200 cents) both fade at one step, each over
    // its own period; Detune 0 and A Uni WT Pos 0.75 (the left voice lower in the table), the right one crosses
    // into frame 1 at 0.5 s, the left one at 0.7 s
    const unison = {};
    const two = { ...FLAT, 'A Unison': 1 / 15 };
    jobs.push(
      note('fade-detuned', {
        seconds: 1,
        state: flip,
        params: { ...two, 'A Uni Detune': 1 },
        automation: [STEP],
        notes: [{ note: 69, on: 0, off: 1 }],
      }).then((channels) => {
        unison.detuned = channels.map((x, c) => {
          const f = 440 * 2 ** ((c ? -200 : 200) / 1200);
          const s = fit(x, RATE, f, 4800, 19200, 3);
          const period = Number(((2 * Math.PI) / s.w).toFixed(1));
          return { period, ...fadeOf(against(x, s, Math.round(0.45 * RATE), x.length)) };
        });
      }),
      note('fade-spread', {
        seconds: 1,
        state: flip,
        params: { ...two, 'A Uni Detune': 0, 'A Uni WT Pos': 0.75 },
        automation: [wtPos([0, 0.1], [0.5, 0.1], [0.5, 0.6], [0.7, 0.6], [0.7, 0.9])],
        notes: [{ note: 57, on: 0, off: 1 }],
      }).then((channels) => {
        unison.spread = channels.map((x) => {
          const s = fit(x, RATE, 220, 4800, 19200);
          return fadeOf(against(x, s, Math.round(0.45 * RATE), x.length));
        });
      })
    );
    // a pitch bend of 12 semitones up and down (Pitch Bend 0.5 → 0.75 or 0.25 over 0.49..0.53 s) while the right
    // voice fades (the left one, on frame 0, has its phase): m = (1 - right / left) / 2, and the period of the left
    // one around it
    const bends = {};
    for (const [name, to] of [
      ['up', 0.75],
      ['down', 0.25],
    ])
      jobs.push(
        note(`fade-bend-${name}`, {
          seconds: 1,
          state: flip,
          params: { ...two, 'A Uni Detune': 0, 'A Uni WT Pos': 1, 'Bend Down': 0.25, 'Bend Up': 0.75 },
          automation: [
            wtPos([0, 0.1], [0.5, 0.1], [0.5, 0.6]),
            {
              name: 'Pitch Bend',
              points: [
                [0, 0.5],
                [0.49, 0.5],
                [0.53, to],
              ],
            },
          ],
          notes: [{ note: 57, on: 0, off: 1 }],
        }).then(([left, right]) => {
          let peak = 0;
          for (let n = 9600; n < 19200; n++) peak = Math.max(peak, Math.abs(left[n]));
          const a = [];
          for (let n = Math.round(0.45 * RATE); n < Math.round(0.7 * RATE); n++)
            if (Math.abs(left[n]) > 0.3 * peak) a.push([n, right[n] / left[n]]);
          const fade = fadeOf(a);
          const crossings = [];
          for (let n = Math.round(0.45 * RATE); n < Math.round(0.7 * RATE); n++)
            if (left[n - 1] < 0 && left[n] >= 0)
              crossings.push(n - 1 - left[n - 1] / (left[n] - left[n - 1]));
          // the period that ends first after t
          const periodAt = (t) => {
            const i = crossings.findIndex((c) => c > t);
            return Number((crossings[i] - crossings[i - 1]).toFixed(1));
          };
          bends[name] = { ...fade, periods: [periodAt(fade.start), periodAt(fade.start + fade.length)] };
        })
      );
    await Promise.all(jobs);
    Object.values(lengths).forEach((rows) => rows.sort((a, b) => a.note - b.note));
    writeFileSync(
      join(out, 'frame-fades.json'),
      `${JSON.stringify(
        {
          about:
            'Osc A of the init patch of the Audio Unit playing tables of ours (frame j (-1)^j · a sine: the sign of the output tells the frame, between two frames it is (1 - 2m) · the sine, m the share of the new one) while A WT Pos is automated (set every 16 samples; the AU glides it, its fades start some ms after a step): `lengths` a step from frame 0 to 1 by rate and note: the sample the fade starts at and its length in samples (the line of m through 0.15..0.85); `sweeps` 256 frames swept from 0.3 s over 4, 1 and 0.25 s at 220 Hz: each change of sign [start, samples, sign before, sign after]; `unison` A Unison 2 (one voice right, one left): `detuned` at Detune 1 (±200 cents) each channel its period and its fade, `spread` Detune 0 and A Uni WT Pos 0.75: the right voice crosses at 0.5 s, the left one at 0.7 s; `bends` a pitch bend of 12 semitones up and down over 0.49..0.53 s while the right voice fades (m against the left one, on frame 0): the fade, the most a sample of it is off its line (`off`) and the periods of the left voice at its start and its end; scripts/renders/run.mjs --only=frame-fades',
          lengths,
          sweeps,
          unison,
          bends,
        },
        null,
        1
      )}\n`
    );
    console.log(
      `dsp/measurements: frame fades of ${Object.keys(lengths).length} rates, ${
        Object.keys(sweeps).length
      } sweeps`
    );
  } finally {
    removeTables();
  }
}

// --- aliasing ---
if (runs('aliasing')) {
  const RATES = [44100, 48000, 96000];
  // the frames of a table of the bucket (mono float32, frames of 2048 samples, 256 at most: as the benchmark reads it)
  const framesOf = (file) => {
    const bytes = readFileSync(file);
    let float = false;
    for (let at = 12; at + 8 <= bytes.length; ) {
      const id = bytes.toString('latin1', at, at + 4);
      const size = bytes.readUInt32LE(at + 4);
      if (id === 'fmt ') float = bytes.readUInt16LE(at + 8) === 3 && bytes.readUInt16LE(at + 22) === 32;
      if (id === 'data') {
        if (!float) throw new Error(`${file}: not float32`);
        const start = bytes.byteOffset + at + 8;
        const samples = new Float32Array(bytes.buffer.slice(start, start + size));
        return Array.from({ length: Math.min(256, Math.floor(samples.length / 2048)) }, (_, k) => [
          ...samples.subarray(k * 2048, (k + 1) * 2048),
        ]);
      }
      at += 8 + size + (size & 1);
    }
    throw new Error(`${file}: no data`);
  };
  const tablesDir = join(root, 'tmp/bench-osc/tables');
  await downloadTables(TABLES, tablesDir);
  const sources = [
    ['saw', sawFrame()],
    ...TABLES.map((key) => {
      const frames = framesOf(join(tablesDir, fileName(key)));
      return [fileName(key), frames[frameOf(frames)]];
    }),
  ];
  // the note nearest to a pitch of the benchmark (it plays 1046 Hz, the AU C6 at 1046.5), the frequency of it the
  // AU plays: the one within ±1 cent (by 0.05) the fundamental is loudest at (the bands of the analysis are ±14
  // bins wide: a harmonic 400 of 55 Hz 0.025 cent off is within 0.3 Hz)
  const noteOf = (pitch) => Math.round(69 + 12 * Math.log2(pitch / 440));
  const fundamental = (x, rate, note) => {
    const nominal = 440 * 2 ** ((note - 69) / 12);
    const from = x.length - SIZE;
    let best = { frequency: nominal, amplitude: -1 };
    for (let c = -20; c <= 20; c++) {
      const frequency = nominal * 2 ** (c / 24000);
      const w = (2 * Math.PI * frequency) / rate;
      let a = 0;
      let b = 0;
      for (let n = from; n < x.length; n++) {
        a += x[n] * Math.cos(w * n);
        b += x[n] * Math.sin(w * n);
      }
      const amplitude = Math.hypot(a, b);
      if (amplitude > best.amplitude) best = { frequency, amplitude };
    }
    return best.frequency;
  };
  const round = (value) => Number(value.toFixed(1));
  try {
    const results = {};
    const floor = {};
    const jobs = [];
    // a note of osc A at one voice on the frame (a table of it alone): its left channel, SIZE samples after 0.25 s
    const play = (name, state, rate, note) =>
      hostRender(name, {
        rate,
        seconds: SIZE / rate + 0.25,
        state,
        params: { ...FLAT, 'A Unison': 0 },
        notes: [{ note, on: 0, off: SIZE / rate + 0.25 }],
      }).then(([left]) => {
        if (left.length < SIZE) throw new Error(`${name}: ${left.length} samples`);
        return left;
      });
    // the floor of the stand: a sine (the patch adds nothing to the oscillator)
    const sineState = tableState('alias-sine', [sine()]);
    for (const rate of RATES)
      jobs.push(
        play(`alias-sine-${rate}`, sineState, rate, 57).then((left) => {
          floor[rate] = round(analyze(left, fundamental(left, rate, 57), rate, sine()).aliasing);
        })
      );
    sources.forEach(([table, frame], t) => {
      const state = tableState(`alias-${t}`, [frame]);
      for (const rate of RATES) {
        const rows = ((results[rate] ??= {})[table] = []);
        PITCHES.forEach((pitch, p) => {
          const note = noteOf(pitch);
          jobs.push(
            play(`alias-${t}-${rate}-${note}`, state, rate, note).then((left) => {
              const frequency = fundamental(left, rate, note);
              const { aliasing, spur, highest } = analyze(left, frequency, rate, frame);
              rows[p] = {
                pitch,
                note,
                frequency: Number(frequency.toFixed(3)),
                aliasing: round(aliasing),
                spur: round(spur),
                highest,
              };
            })
          );
        });
      }
    });
    await Promise.all(jobs);
    writeFileSync(
      join(out, 'aliasing.json'),
      `${JSON.stringify(
        {
          about:
            'Osc A of the init patch of the Audio Unit at one voice on a table of one frame: the frame the oscillator benchmark compares (scripts/bench-osc/sound.mjs: the saw, the middle frame of each of its tables), a note of each of its pitches (the nearest one: 1046 Hz is C6 at 1046.5) at each of its rates; `analyze` of the benchmark over the last 65536 samples (from 0.25 s on), at the frequency the fundamental is loudest at within ±1 cent of the note: `aliasing` the power outside the harmonics against theirs, `spur` the loudest bin outside them against the fundamental (dB), `highest` the highest harmonic played at half its amplitude in the frame at least; `floor` the aliasing of a sine at A3 (the noise of the stand); scripts/renders/run.mjs --only=aliasing',
          floor,
          rates: results,
        },
        null,
        1
      )}\n`
    );
    console.log(
      `dsp/measurements: aliasing of ${sources.length} tables at ${
        RATES.length
      } rates, floor ${JSON.stringify(floor)}`
    );
  } finally {
    removeTables();
  }
}
