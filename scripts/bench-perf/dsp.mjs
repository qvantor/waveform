// the fast layer of the suite (`--only=dsp`, about 20 s, no browser): the signal processing of the app in Node,
// ns per sample, each divided by the ns of a fixed multiply-add of the same run (the speed of the machine out);
// 7 samples a case. With a reference (--against) its code is bundled too and the samples of both alternate in
// one process (A B B A …), the regressions compare them (report.mjs). V8, not JSC: it catches regressions of the
// algorithms (a hot loop that boxes doubles), not of the engines
import fs from 'node:fs';
import path from 'node:path';
import { loadApp, median, root } from './util.mjs';

const BLOCK = 128;
const RATE = 48000;
const SAMPLES = 7;

const ENTRY = `
export { buildLevels } from './apps/waveform/src/app/synth/common/wavetable/wavetable-mipmap';
`;

// the TS cores of a tree that has them (before stage 5 of the plan: an A/B run against main of that time)
const TS_CORES = [
  {
    module: 'apps/waveform/src/app/synth/common/wavetable/wavetable-osc-dsp',
    create: 'createVoiceDsp, createVoiceShared, createTableStore',
  },
  { module: 'apps/waveform/src/app/synth/fx/effects/reverb-dsp', create: 'createReverbDsp' },
  { module: 'apps/waveform/src/app/synth/fx/effects/distortion-dsp', create: 'createDistortionDsp' },
  { module: 'apps/waveform/src/app/synth/common/limiter/limiter-dsp', create: 'createLimiterDsp' },
];

// the Rust cores (dsp/, `npm run wasm`: tmp/wasm, as in production) of the tree that has them: its facade and
// the bytes of the core
const WASM_CORES = [
  {
    core: 'limiter',
    facade: 'apps/waveform/src/app/synth/common/limiter/limiter-wasm',
    create: 'createLimiterWasm',
  },
  {
    core: 'reverb',
    facade: 'apps/waveform/src/app/synth/fx/effects/reverb-wasm',
    create: 'createReverbWasm',
  },
  {
    core: 'distortion',
    facade: 'apps/waveform/src/app/synth/fx/effects/distortion-wasm',
    create: 'createDistortionWasm',
  },
  {
    core: 'wavetable-osc',
    facade: 'apps/waveform/src/app/synth/common/wavetable/wavetable-osc-wasm',
    create: 'createOscScope, createTableStoreWasm, createVoiceSharedWasm, createVoiceWasm',
    // (a tree of the voices node: its scope too)
    optional: 'createVoiceScopeWasm',
  },
];

const WASM_CORE = 'apps/waveform/src/app/synth/common/wasm/wasm-core';
// the tables of the shapes of the LFOs (a tree that has them)
const LFO_CURVE = 'apps/waveform/src/app/synth/common/lfo/lfo-curve';

// as in production: the counters of the perf build out. A tree with wasm cores bundles their facades too and
// instantiates them (one instance per core, as one AudioWorkletGlobalScope)
const loadDsp = async (source = root, name) => {
  const cores = WASM_CORES.filter(
    ({ core, facade }) =>
      fs.existsSync(path.join(source, `${facade}.ts`)) &&
      fs.existsSync(path.join(source, `tmp/wasm/${core}.wasm`))
  );
  const ts = TS_CORES.filter(({ module }) => fs.existsSync(path.join(source, `${module}.ts`)));
  // (instantiated by its instantiateCore, as the worklets do: a tree that guards the calls of its cores pays for it)
  const instantiate = cores.length > 0 && fs.existsSync(path.join(source, `${WASM_CORE}.ts`));
  const contents = `${ENTRY}${[
    ...ts.map(({ module, create }) => [module, create]),
    ...cores.map(({ facade, create, optional }) => [
      facade,
      optional &&
      fs.readFileSync(path.join(source, `${facade}.ts`), 'utf8').includes(`export const ${optional} `)
        ? `${create}, ${optional}`
        : create,
    ]),
    ...(instantiate ? [[WASM_CORE, 'instantiateCore']] : []),
    ...(fs.existsSync(path.join(source, `${LFO_CURVE}.ts`)) ? [[LFO_CURVE, 'lfoTable']] : []),
  ]
    .map(([module, create]) => `export { ${create} } from './${module}';\n`)
    .join('')}`;
  const dsp = await loadApp({ source, contents, name });
  const wasm = Object.fromEntries(
    cores.map(({ core }) => {
      const module = new WebAssembly.Module(fs.readFileSync(path.join(source, `tmp/wasm/${core}.wasm`)));
      return [core, instantiate ? dsp.instantiateCore(module) : new WebAssembly.Instance(module).exports];
    })
  );
  return { ...dsp, wasm };
};

// a table of 256 frames of 2048 samples as the store takes it (its layout is not read) and a chunk of it (1 MB)
const TABLE_256 = { frames: 256, harmonics: [1], lengths: [8], offsets: [0], length: 16670976 };
const CHUNK = new Float32Array(262144);

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
  // the voices: a table of 16 frames `a` in the store of each core (a held voice costs the same on any count) and
  // one of 256 `b` (as a table with a morph mark plays: a moving position changes frame more often than a fade
  // lasts, the voices fade almost all the time)
  const store = dsp.createTableStore?.();
  const frames = Array.from({ length: 256 }, (_, k) => frame(k));
  const levels = dsp.buildLevels(frames.slice(0, 16));
  const levels256 = dsp.buildLevels(frames);
  store?.set('a', 1, levels);
  store?.set('b', 1, levels256);
  const oscScope = dsp.wasm['wavetable-osc'] && dsp.createOscScope(dsp.wasm['wavetable-osc']);
  const wasmStore = oscScope && dsp.createTableStoreWasm(oscScope);
  wasmStore?.set('a', 1, levels);
  wasmStore?.set('b', 1, levels256);
  // (as the worklet: its store processor listens for the memory the store frees, read after every block)
  wasmStore?.listen?.(() => undefined);
  const createShared = { ts: () => dsp.createVoiceShared(), wasm: () => dsp.createVoiceSharedWasm(oscScope) };
  const createVoice = {
    ts: (options, shared = createShared.ts()) =>
      dsp.createVoiceDsp(RATE, options, store, Math.random, shared),
    wasm: (options, shared = createShared.wasm()) =>
      dsp.createVoiceWasm(oscScope, RATE, options, wasmStore, Math.random, shared),
  };
  // (a unison shape: a tree before it plays the unison plain; a velocity: a tree before it plays at the amp 1)
  const voiceOf = (core, unisonShape, velocity) => (oscs, params, table) => () => {
    const options = {
      osc: oscs.map((unison) =>
        unison
          ? { table: table ?? 'a', unison, phase: 0, phaseRand: 1, ...(unisonShape && { unisonShape }) }
          : null
      ),
      start: 0,
      // ENV 1 at full level, no route, no filter: the oscillators as they play
      envelopes: [0, 1, 2].map(() => ({ attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 })),
      envStart: 0,
      phrase: 0,
      routes: [],
      filter: null,
      ...(velocity && { velocity }),
    };
    const voiceDsp = createVoice[core](options);
    let frameAt = 0;
    return () => {
      voiceDsp.process(frameAt, typeof params === 'function' ? params(frameAt) : params, outL, outR);
      frameAt += BLOCK;
    };
  };
  // a chord of 12 notes × 2 × u8 struck again every ATTACK blocks, about the time its 192 unison voices take to go
  // onto their mix tables under the budget: the direct path, the builds, the note on (the peak of a block is
  // there); one shared a core, its pool of mix tables as in a scope
  const ATTACK = 40;
  const chord = [48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 71, 72].map((note) =>
    constant({ ...BASE, frequency: 440 * 2 ** ((note - 69) / 12), spread1: 25, spread2: 35 })
  );
  const chordOf = (core) => () => {
    const shared = createShared[core]();
    const options = {
      osc: [0, 1].map(() => ({ table: 'a', unison: 8, phase: 0, phaseRand: 1 })),
      start: 0,
      envelopes: [0, 1, 2].map(() => ({ attack: 0.01, hold: 0.1, decay: 0.3, sustain: 0.8, release: 0.3 })),
      envStart: 0,
      phrase: 0,
      routes: [],
      filter: null,
    };
    let voices = [];
    let block = 0;
    return () => {
      if (block % ATTACK === 0) {
        voices.forEach((voice) => voice.end?.());
        voices = chord.map(() => createVoice[core](options, shared));
      }
      voices.forEach((voice, i) => voice.process(block * BLOCK, chord[i], outL, outR));
      block++;
    };
  };
  // the same chord as the voices of one node (scope.rs): their note ons as events, their params from their
  // timelines, their sum; struck again, a node of its own (the voices before end at once, as above)
  const scopeOptions = {
    osc: [0, 1].map(() => ({ table: 'a', unison: 8, phase: 0, phaseRand: 1 })),
    start: 0,
    envelopes: [0, 1, 2].map(() => ({ attack: 0.01, hold: 0.1, decay: 0.3, sustain: 0.8, release: 0.3 })),
    envStart: 0,
    phrase: 0,
    routes: [],
    filter: null,
  };
  const scopeNotes = (voices) =>
    voices.apply(
      chord.map((params, voice) => ({
        kind: 'on',
        voice,
        options: scopeOptions,
        params: Object.fromEntries(Object.entries(params).map(([k, [v]]) => [k, v])),
      }))
    );
  const scopeChord = () => {
    const shared = createShared.wasm();
    let voices = null;
    let block = 0;
    return () => {
      if (block % ATTACK === 0) {
        voices?.free();
        voices = dsp.createVoiceScopeWasm(oscScope, RATE, wasmStore, shared);
        scopeNotes(voices);
      }
      voices.process(block * BLOCK, outL, outR);
      voices.reports();
      block++;
    };
  };
  // the chord struck once and the pitch bend of the node: up a semitone and back over BENDING blocks (an event
  // every 2: what the throttle of the app lets through from a wheel, 5 ms), then at rest until the next BEND. Every
  // voice plays directly while it moves, then builds its mixes again under the budget
  const BEND = 60;
  const BENDING = 20;
  const scopeChordBend = () => {
    const voices = dsp.createVoiceScopeWasm(oscScope, RATE, wasmStore, createShared.wasm());
    scopeNotes(voices);
    let block = 0;
    return () => {
      const at = block % BEND;
      if (at < BENDING && at % 2 === 0) voices.setBend(50 * (1 - Math.cos((2 * Math.PI * at) / BENDING)));
      voices.process(block * BLOCK, outL, outR);
      voices.reports();
      block++;
    };
  };
  const held = constant(BASE);
  // the LFOs of a shared or a node: sines of `period` seconds, retrig, at once with their tables (a tree before
  // them: none)
  const lfoState = (period) => ({
    at: 0,
    instantly: true,
    lfos: [0, 1, 2, 3].map(() => ({
      mode: 0,
      delay: 0,
      rise: 0,
      smooth: 0,
      phase: 0,
      anchor: { time: 0, phase: 0, period },
      table: dsp.lfoTable('sine'),
    })),
  });
  // a u8 voice LFO 1 moves a param of (a sine of 0.5 s on its position: the direct path, a frame at a time; on its
  // gain: the gain per sample, the voice on its mix tables; a vibrato of 5 Hz on its Fine: the pitch moves all
  // along)
  const lfoVoiceOf =
    (param, amount, route = { min: 0, max: 1 }, period = 0.5) =>
    () => {
      const flat = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
      const shared = createShared.wasm();
      shared.setLfos(lfoState(period));
      const voiceDsp = createVoice.wasm(
        {
          osc: [{ table: 'a', unison: 8, phase: 0, phaseRand: 1 }, null],
          start: 0,
          envelopes: [flat, flat, flat],
          envStart: 0,
          phrase: 0,
          routes: [{ source: 4, param, amount, ...route }],
          filter: null,
        },
        shared
      );
      let frameAt = 0;
      return () => {
        voiceDsp.process(frameAt, held, outL, outR);
        frameAt += BLOCK;
      };
    };
  // the chord of `scope chord attack` with a lowpass LFO 1 moves around its cutoff (bipolar, ±1 octave, 4 Hz),
  // the coefficients of every voice worked out again every 32 samples
  const scopeChordLfo = () => {
    const shared = createShared.wasm();
    let voices = null;
    let block = 0;
    const options = {
      ...scopeOptions,
      filter: { type: 'lowpass', cutoff: 1200, resonance: 3, gain: 0 },
      routes: [{ source: 4, param: 'cutoff', amount: 2, min: 20, max: 20000, scale: 'log', bipolar: true }],
    };
    return () => {
      if (block % ATTACK === 0) {
        voices?.free();
        voices = dsp.createVoiceScopeWasm(oscScope, RATE, wasmStore, shared);
        voices.apply([{ kind: 'lfos', ...lfoState(0.25) }]);
        voices.apply(
          chord.map((params, voice) => ({
            kind: 'on',
            voice,
            options,
            params: Object.fromEntries(Object.entries(params).map(([k, [v]]) => [k, v])),
          }))
        );
      }
      voices.process(block * BLOCK, outL, outR);
      voices.reports();
      block++;
    };
  };
  // a voice whose routes move all the time: ENV 2 and 3 (a decay of 0.2 s, started again every 64 blocks by the
  // gate held at its other value) on the gain, the cutoff and the resonance of the filter, worked out at the points
  // of every 32 samples (the hot loop of the routes; u1: the oscillator costs little next to them). No velocity: a
  // tree before it has none
  const AGAIN = 64;
  const heldAgain = constant({ ...BASE, gate: 1.5 });
  const flat = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
  // a call of a voice: a block, the gate at its other value every AGAIN blocks
  const retriggered = (voiceDsp) => {
    let block = 0;
    return () => {
      voiceDsp.process(block * BLOCK, Math.floor(block / AGAIN) % 2 ? heldAgain : held, outL, outR);
      block++;
    };
  };
  const routedOf = (core) => () => {
    const decay = { attack: 0, hold: 0, decay: 0.2, sustain: 0, release: 0 };
    const voiceDsp = createVoice[core]({
      osc: [{ table: 'a', unison: 1, phase: 0, phaseRand: 0 }, null],
      start: 0,
      envelopes: [flat, decay, decay],
      envStart: 0,
      phrase: 0,
      // (in the fields of every tree: `env` and `log` before the LFOs, `source` and `scale` since)
      routes: [
        { env: 1, source: 1, param: 'gain1', amount: -0.5, min: 0, max: 1 },
        { env: 1, source: 1, param: 'cutoff', amount: 4, min: 20, max: 20000, log: true, scale: 'log' },
        { env: 2, source: 2, param: 'resonance', amount: 12, min: -12, max: 24 },
      ],
      filter: { type: 'lowpass', cutoff: 400, resonance: 3, gain: 0 },
    });
    return retriggered(voiceDsp);
  };
  // a kick of u8: ENV 2 from 36 semitones over the note down to it in 80 ms (bounds wider than those of Semi: the
  // pitch moves all along), the envelopes started again every AGAIN blocks (as `voice u1 routed`): the direct path
  // while the pitch moves, then its mix tables again; its cost over `voice u8 held` (a tree before the pitch as a
  // target: none)
  const pitchEnv = () => {
    const kick = { attack: 0, hold: 0, decay: 0.08, sustain: 0, release: 0 };
    const voiceDsp = createVoice.wasm({
      osc: [{ table: 'a', unison: 8, phase: 0, phaseRand: 1 }, null],
      start: 0,
      envelopes: [flat, kick, flat],
      envStart: 0,
      phrase: 0,
      routes: [{ source: 1, param: 'pitch1', amount: 3600, min: -12000, max: 12000 }],
      filter: null,
    });
    return retriggered(voiceDsp);
  };
  // whether the tree's routes move the pitch of an oscillator (Semi and Fine as targets of its facade; another one
  // leaves such a route out, its voice has no modulation): a block of a voice a route takes an octave up against
  // one without
  const pitchRoutes =
    !!oscScope &&
    (() => {
      const blockOf = (routes) => {
        createVoice
          .wasm({
            osc: [{ table: 'a', unison: 1, phase: 0, phaseRand: 0 }, null],
            start: 0,
            envelopes: [flat, flat, flat],
            envStart: 0,
            phrase: 0,
            routes,
            filter: null,
          })
          .process(0, held, outL, outR);
        return outL.slice();
      };
      const up = blockOf([{ source: 1, param: 'pitch1', amount: 1200, min: -12000, max: 12000 }]);
      return blockOf([]).some((sample, i) => sample !== up[i]);
    })();
  // a position that moves in every block: the direct path. Its blocks over a period of the LFO (2 s) are worked
  // out once, not in the call: making them there (Float32Array.from, 128 sines) cost 34 ns/sample, more than the
  // core itself
  const moving = { ...held };
  const PERIOD = (2 * RATE) / BLOCK;
  const positions = Array.from({ length: PERIOD }, (_, block) =>
    Float32Array.from(
      { length: BLOCK },
      (_, i) => 0.5 + 0.5 * Math.sin(2 * Math.PI * (((block * BLOCK) / RATE) * 0.5 + i / RATE / 2))
    )
  );
  const movingPosition = (frameAt) => {
    moving.position1 = positions[(frameAt / BLOCK) % PERIOD];
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
  const distortionParams = (mode) => ({ params: { mode, drive: 8, tone: 20000, level: 0 } });
  return {
    ...withTs(
      {
        'voice u1 held': [[1, null], held],
        'voice u8 held': [[8, null], held],
        'voice 2 × u8 held': [[8, 8], held],
        'voice u8 moving position': [[8, null], movingPosition],
        'voice u8 moving position, 256 frames': [[8, null], movingPosition, 'b'],
      },
      oscScope && voiceOf('wasm'),
      store && voiceOf('ts')
    ),
    // blend, width (the channels of the oscillator and their pan), a stack and a position spread (a frame per
    // voice); its cost over `voice u8 held`
    ...withTs(
      { 'voice u8 shaped unison': [[8, null], held] },
      oscScope &&
        voiceOf('wasm', { blend: 0.75, width: 0.5, stack: '12+7x2', detune: 'linear', positionSpread: 0.3 }),
      null
    ),
    // a note of QWERTY or the piano (velocity 100) at Amp 1: the amp of its velocity 0.787; its cost over `voice u1
    // held`
    ...withTs(
      { 'voice u1 velocity': [[1, null], held] },
      oscScope && voiceOf('wasm', undefined, { level: 0.787, amp: 0.787 }),
      null
    ),
    ...withTs({ 'voice u8 pitch env': [] }, pitchRoutes && (() => pitchEnv), null),
    ...withTs(
      { 'voice u1 routed': [] },
      oscScope && (() => routedOf('wasm')),
      store && (() => routedOf('ts'))
    ),
    ...withTs(
      { 'voice chord attack': [] },
      oscScope && (() => chordOf('wasm')),
      store && (() => chordOf('ts'))
    ),
    ...(dsp.createVoiceScopeWasm && { 'scope chord attack': scopeChord }),
    // (a tree before the pitch bend: none)
    ...(oscScope?.exports.osc_scope_bend && { 'scope chord bend': scopeChordBend }),
    // (a tree before the LFOs: none; before the pitch as a target: no vibrato)
    ...(oscScope?.exports.osc_shared_lfos &&
      dsp.lfoTable && {
        'voice u8 lfo wave': lfoVoiceOf('position1', 1),
        'voice u8 lfo gain': lfoVoiceOf('gain1', -0.5),
        ...(pitchRoutes && {
          'voice u8 lfo fine': lfoVoiceOf('fine1', 100, { min: -100, max: 100, bipolar: true }, 0.2),
        }),
        'scope chord lfo cutoff': scopeChordLfo,
      }),
    'build 256 frames': {
      build: () => {
        const start = process.hrtime.bigint();
        dsp.buildLevels(frames);
        return Number(process.hrtime.bigint() - start) / 1e6;
      },
    },
    // the store takes a table of 256 frames no buffer of its pool holds (a store of its own): its begin and its
    // first chunk, on the audio thread (a tree that zeroes the whole table in begin: 0.75 ms on memory the
    // allocator had, 4.2 on new memory; the first sample of a side is the new memory)
    ...(oscScope && {
      'store begin 64 MiB, a miss of the pool': {
        build: () => {
          const tables = dsp.createTableStoreWasm(oscScope);
          const start = process.hrtime.bigint();
          const slot = tables.begin('b', 1, TABLE_256);
          tables.write(slot, 0, CHUNK);
          const ms = Number(process.hrtime.bigint() - start) / 1e6;
          tables.commit(slot);
          tables.free();
          return ms;
        },
      },
    }),
    ...withTs(
      { reverb: [input] },
      dsp.wasm.reverb &&
        ((source) =>
          effect(
            () => dsp.createReverbWasm(dsp.wasm.reverb, RATE, { params: REVERB, active: true }).process,
            source
          )),
      dsp.createReverbDsp &&
        ((source) =>
          effect(() => dsp.createReverbDsp(RATE, { params: REVERB, active: true }).process, source))
    ),
    ...withTs(
      { 'distortion soft': [0], 'distortion hard': [1] },
      dsp.wasm.distortion &&
        ((mode) =>
          effect(
            () => dsp.createDistortionWasm(dsp.wasm.distortion, RATE, distortionParams(mode)).process,
            input
          )),
      dsp.createDistortionDsp &&
        ((mode) => effect(() => dsp.createDistortionDsp(RATE, distortionParams(mode)).process, input))
    ),
    ...withTs(
      {
        // silence: the limiter skips its blocks once it has let go
        'limiter silent': [new Float32Array(RATE)],
        // under the bound of its true peaks: the samples alone
        'limiter quiet': [noise(RATE, 0.05)],
        // over it, under the ceiling: the 4× interpolation of both sides
        'limiter loud': [noise(RATE, 0.4)],
        'limiter limiting': [noise(RATE, 2)],
      },
      dsp.wasm.limiter &&
        ((source) => effect(() => dsp.createLimiterWasm(dsp.wasm.limiter, RATE).process, source)),
      dsp.createLimiterDsp && ((source) => effect(() => dsp.createLimiterDsp(RATE).process, source))
    ),
  };
};

// the cases of a module: with its wasm core they run it (an A/B run against a tree without it compares the cores),
// with its TS core too as '<case> (ts)' (a tree of the port, before stage 5), with the TS core alone that one
const withTs = (sources, wasm, ts) =>
  Object.fromEntries(
    Object.entries(sources).flatMap(([name, args]) => [
      ...(wasm ? [[name, wasm(...args)]] : []),
      ...(ts ? [[wasm ? `${name} (ts)` : name, ts(...args)]] : []),
    ])
  );

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
