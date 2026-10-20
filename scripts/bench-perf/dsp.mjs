// the fast layer of the suite (`--only=dsp`, about 20 s, no browser): the signal processing of the app in Node,
// ns per sample, each divided by the ns of a fixed multiply-add of the same run (the speed of the machine out);
// 7 samples a case. With a reference (--against) its code is bundled too and the samples of both alternate in
// one process (A B B A …), the regressions compare them (report.mjs). V8, not JSC: it catches regressions of the
// algorithms (a hot loop that boxes doubles), not of the engines
import { loadApp, median } from './util.mjs';

const BLOCK = 128;
const RATE = 48000;
const SAMPLES = 7;

const ENTRY = `
export { createVoiceDsp, createVoiceShared, createTableStore } from './apps/waveform/src/app/synth/common/wavetable/wavetable-osc-dsp';
export { buildLevels } from './apps/waveform/src/app/synth/common/wavetable/wavetable-mipmap';
export { createReverbDsp } from './apps/waveform/src/app/synth/fx/effects/reverb-dsp';
export { createDistortionDsp } from './apps/waveform/src/app/synth/fx/effects/distortion-dsp';
export { createLimiterDsp } from './apps/waveform/src/app/synth/common/limiter/limiter-dsp';
`;

// as in production: the counters of the perf build out
const loadDsp = (source, name) => loadApp({ source, contents: ENTRY, name });

// ns per call over `ms` at least
const timeCalls = (call, ms) => {
  let calls = 0;
  const start = process.hrtime.bigint();
  let elapsed = 0;
  while (elapsed < ms * 1e6) {
    for (let i = 0; i < 16; i++) call();
    calls += 16;
    elapsed = Number(process.hrtime.bigint() - start);
  }
  return elapsed / calls;
};

// the samples of each side: a warm-up of each (the JIT), then SAMPLES each, the sides alternating A B B A …
// (`sample` takes one: ns per call over 0.2 s, or what a call returns)
const alternate = (sides, sample, warm) => {
  sides.forEach(warm);
  const samples = sides.map(() => []);
  for (let i = 0; i < SAMPLES; i++) {
    const order = sides.map((_, side) => side);
    if (i % 2) order.reverse();
    order.forEach((side) => samples[side].push(sample(sides[side])));
  }
  return samples;
};
const measure = (calls) =>
  alternate(
    calls,
    (call) => timeCalls(call, 200),
    (call) => timeCalls(call, 300)
  );

// the speed of the machine: ns of one multiply-add of a typed array
const calibrate = () => {
  const a = Float64Array.from({ length: 4096 }, (_, i) => Math.sin(i));
  const b = Float64Array.from({ length: 4096 }, (_, i) => Math.cos(i));
  let sink = 0;
  const [samples] = measure([
    () => {
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
      sink += sum;
    },
  ]);
  return { ns: median(samples) / a.length, sink };
};

// a frame of a band-limited saw with its harmonics shifted by `k` (the frames of a table differ)
const frame = (k, size = 2048) =>
  Float32Array.from({ length: size }, (_, n) => {
    let sum = 0;
    for (let h = 1; h <= 64; h++) sum += Math.sin((2 * Math.PI * h * n) / size + k * h * 0.01) / h;
    return sum;
  });

const noise = (length, amplitude) => {
  let seed = 1;
  return Float32Array.from({ length }, () => {
    seed = (seed * 16807) % 2147483647;
    return amplitude * ((seed / 2147483647) * 2 - 1);
  });
};

const BASE = {
  frequency: 220,
  gate: 1,
  position1: 0.5,
  position2: 0.5,
  detune1: 0,
  detune2: -1200,
  spread1: 20,
  spread2: 20,
  gain1: 0.5,
  gain2: 0.5,
};
const REVERB = {
  lowcut: 20,
  pre: 0.02,
  size: 0.5,
  decay: 3,
  damp: 6000,
  bass: 1,
  depth: 0.2,
  sep: 1,
  er: 0.5,
  drive: 0,
  bandwidth: RATE / 2,
  body: 0,
};
const constant = (values) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Float32Array.of(value)]));

// the cases of a bundle of the code: a call (one block: ns per sample = ns per call / BLOCK), or for the build a
// sample of its own (ms of a build of 256 frames)
const createCases = (dsp) => {
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  // the voices: a table of 16 frames (the cost of a voice doesn't depend on their count)
  const store = dsp.createTableStore();
  store.set('a', 1, dsp.buildLevels(Array.from({ length: 16 }, (_, k) => frame(k))));
  const voice = (oscs, params) => () => {
    const options = {
      osc: oscs.map((unison) => (unison ? { table: 'a', unison, phase: 0, phaseRand: 1 } : null)),
      start: 0,
      // ENV 1 at full level, no route, no filter: the oscillators as they play
      envelopes: [0, 1, 2].map(() => ({ attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 })),
      envStart: 0,
      phrase: 0,
      routes: [],
      filter: null,
    };
    const voiceDsp = dsp.createVoiceDsp(RATE, options, store, Math.random, dsp.createVoiceShared());
    let frameAt = 0;
    return () => {
      voiceDsp.process(frameAt, typeof params === 'function' ? params(frameAt) : params, outL, outR);
      frameAt += BLOCK;
    };
  };
  const held = constant(BASE);
  // a position that moves in every block: the direct path
  const moving = { ...held };
  const movingPosition = (frameAt) => {
    const phase = (frameAt / RATE) * 0.5;
    moving.position1 = Float32Array.from(
      { length: BLOCK },
      (_, i) => 0.5 + 0.5 * Math.sin(2 * Math.PI * (phase + i / RATE / 2))
    );
    return moving;
  };
  // the effects over noise, block by block
  const effect = (create, source) => () => {
    const process = create();
    let at = 0;
    const inL = new Float32Array(BLOCK);
    const inR = new Float32Array(BLOCK);
    return () => {
      inL.set(source.subarray(at, at + BLOCK));
      inR.set(source.subarray(at, at + BLOCK));
      process(inL, inR, outL, outR);
      at = (at + BLOCK) % (source.length - BLOCK);
    };
  };
  const input = noise(RATE, 0.5);
  const frames = Array.from({ length: 256 }, (_, k) => frame(k));
  const distortion = (mode) => () =>
    dsp.createDistortionDsp(RATE, { params: { mode, drive: 8, tone: 20000, level: 0 } }).process;
  return {
    'voice u1 held': voice([1, null], held),
    'voice u8 held': voice([8, null], held),
    'voice 2 × u8 held': voice([8, 8], held),
    'voice u8 moving position': voice([8, null], movingPosition),
    'build 256 frames': {
      build: () => {
        const start = process.hrtime.bigint();
        dsp.buildLevels(frames);
        return Number(process.hrtime.bigint() - start) / 1e6;
      },
    },
    reverb: effect(() => dsp.createReverbDsp(RATE, { params: REVERB, active: true }).process, input),
    'distortion soft': effect(distortion(0), input),
    'distortion hard': effect(distortion(1), input),
    'limiter quiet': effect(() => dsp.createLimiterDsp(RATE).process, noise(RATE, 0.05)),
    'limiter limiting': effect(() => dsp.createLimiterDsp(RATE).process, noise(RATE, 2)),
  };
};

// `reference`: the worktree of the reference of an A/B run (reference.mjs), its samples alternate with ours
export const runDspBenchmarks = async ({ reference = null } = {}) => {
  const current = createCases(await loadDsp(undefined, 'dsp'));
  let other = null;
  let referenceError = null;
  if (reference) {
    try {
      other = createCases(await loadDsp(reference.dir, `dsp-${reference.short}`));
    } catch (error) {
      referenceError = error.message;
    }
  }
  const calibration = calibrate();
  const cases = {};
  for (const [name, kase] of Object.entries(current)) {
    const theirs = other?.[name];
    const build = 'build' in kase;
    const sides = [kase, theirs].filter(Boolean);
    let samples;
    try {
      samples = build
        ? alternate(
            sides.map(({ build: run }) => run),
            (run) => run(),
            (run) => run()
          )
        : measure(sides.map((create) => create()));
    } catch (error) {
      // an API the reference doesn't have: ours alone
      if (sides.length < 2) throw error;
      samples = build
        ? alternate(
            [kase.build],
            (run) => run(),
            (run) => run()
          )
        : measure([kase()]);
      samples.push(null);
      referenceError ??= `${name}: ${error.message}`;
    }
    // ns per sample divided by the ns of a multiply-add; the build: its ns
    const unit = build ? 'ms' : 'ns/sample';
    const ns = (sample) => (build ? sample * 1e6 : sample / BLOCK);
    const side = (values) =>
      values && {
        value: median(values.map((sample) => (build ? sample : sample / BLOCK))),
        normalized: median(values.map((sample) => ns(sample) / calibration.ns)),
        samples: values.map((sample) => ns(sample) / calibration.ns),
      };
    cases[name] = { unit, ...side(samples[0]), ...(samples[1] && { reference: side(samples[1]) }) };
  }
  return {
    node: process.versions.node,
    calibration: calibration.ns,
    cases,
    ...(reference && { reference: { sha: reference.short, error: referenceError } }),
  };
};
