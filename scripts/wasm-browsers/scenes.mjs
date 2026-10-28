// the scenes of the browser parity (run.mjs): a processor of a worklet bundle, its node options and an input; the
// reference renders the same blocks with the wasm core in Node (tmp/wasm, the facade of the app bundled by esbuild)
import fs from 'node:fs';
import path from 'node:path';
import { loadApp } from '../bench-perf/util.mjs';
import { root } from '../bench-common.mjs';

const RATE = 48000;
const BLOCK = 128;
const STEREO = {
  numberOfInputs: 1,
  numberOfOutputs: 1,
  outputChannelCount: [2],
  channelCount: 2,
  channelCountMode: 'explicit',
  channelInterpretation: 'speakers',
};

// a deterministic stereo input: a chord of sines (computed here, the page gets its bits) and noise
const signal = (frames, amplitude) => {
  let seed = 7;
  return [0, 1].map((channel) =>
    Float32Array.from({ length: frames }, (_, n) => {
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647) * 2 - 1;
      const tone = Math.sin(n / (7 + channel)) + 0.5 * Math.sin(n / 2.3) + 0.25 * Math.sin(n / 0.9);
      return amplitude * (n < frames * 0.6 ? 0.7 * tone + 0.1 * noise : 0);
    })
  );
};

const REVERB = {
  lowcut: 20,
  pre: 0.02,
  size: 0.6,
  decay: 2.5,
  damp: 7000,
  bass: 1.2,
  depth: 0.3,
  sep: 1,
  er: 0.5,
  drive: 0.15,
  bandwidth: 6500,
  body: 2,
};

// the voices of the wavetable oscillator: a store node with the tables (posted to its port, the page waits for
// their acks), the voices node with the events of every voice (its options and initial params, the steps of the
// gate at frames exact in binary: a rate of 2^15). phaseRand 0: Math.random draws nothing that sounds
const OSC_RATE = 32768;
const saw = (size, harmonics, shift = 0) =>
  Array.from({ length: size }, (_, n) => {
    let sum = 0;
    for (let k = 1; k <= harmonics; k++) sum += Math.sin((2 * Math.PI * k * n) / size + shift * k) / k;
    return sum;
  });
const FLAT = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
const ENV = { attack: 0.01, hold: 0.005, decay: 0.05, sustain: 0.6, release: 0.08 };
const oscScene = (name, { tables, voices, frames, lfos = null }) => ({
  name,
  module: 'wavetable-osc',
  kind: 'osc',
  rate: OSC_RATE,
  frames,
  tables,
  voices,
  lfos,
});
// the LFOs of a scene: at once, the shapes as tables of 2049 levels (lfoTable of the app, built in Node: the page
// gets their bits)
const lfo = (shape, change = {}) => ({
  mode: 0,
  delay: 0,
  rise: 0,
  smooth: 0,
  phase: 0,
  anchor: { time: 0, phase: 0, period: 0.1 },
  shape,
  ...change,
});
const note = (osc, params, gate = [], options = {}) => ({
  options: {
    osc,
    start: 0,
    envelopes: [FLAT, FLAT, FLAT],
    envStart: 0,
    phrase: 0,
    routes: [],
    filter: null,
    ...options,
  },
  params,
  gate,
});
const OSC_SCENES = [
  oscScene('wavetable, a chord of unisons', {
    frames: OSC_RATE / 2,
    tables: { a: [saw(2048, 400), saw(2048, 60, 0.3)], b: [saw(2048, 900)] },
    voices: [110, 165, 220].map((frequency, i) =>
      note(
        [
          { table: 'a', unison: 4 + i, phase: 0.1 * i, phaseRand: 0 },
          { table: 'b', unison: 2, phase: 0.5, phaseRand: 0 },
        ],
        { frequency, spread1: 25, spread2: 10, position1: 0.4, detune2: -1200, gain1: 0.4, gain2: 0.3 }
      )
    ),
  }),
  // (a linear detune: the worklet draws the shares of a random one with Math.random)
  oscScene('wavetable, a shaped unison', {
    frames: OSC_RATE / 2,
    tables: { a: [saw(2048, 400), saw(2048, 60, 0.3), saw(1024, 200, 0.6)] },
    voices: [
      note(
        [
          {
            table: 'a',
            unison: 7,
            phase: 0.2,
            phaseRand: 0,
            unisonShape: { blend: 0.8, width: 0.35, stack: '12+7x2', detune: 'super', positionSpread: 0.5 },
          },
          {
            table: 'a',
            unison: 4,
            phase: 0,
            phaseRand: 0,
            unisonShape: { blend: 0.2, width: 1, stack: 'center-12', detune: 'linear', positionSpread: 0 },
          },
        ],
        { frequency: 147, spread1: 30, spread2: 0, position1: 0.5, gain1: 0.4, gain2: 0.3 }
      ),
    ],
  }),
  oscScene('wavetable, released, stolen, filtered and routed', {
    frames: OSC_RATE / 2,
    tables: { a: [saw(2048, 200), saw(1024, 300, 0.7), saw(2048, 50)] },
    voices: [
      note(
        [{ table: 'a', unison: 3, phase: 0, phaseRand: 0 }, null],
        { frequency: 330, spread1: 15 },
        [[4096, 2.12]],
        {
          envelopes: [ENV, { attack: 0.1, hold: 0, decay: 0.1, sustain: 0.2, release: 0.1 }, FLAT],
          routes: [{ source: 1, param: 'position1', amount: 1, min: 0, max: 1 }],
        }
      ),
      note(
        [{ table: 'a', unison: 1, phase: 0.25, phaseRand: 0 }, null],
        { frequency: 55, position1: 0.7 },
        [[8192, -1]],
        {
          filter: { type: 'lowpass', cutoff: 900, resonance: 8, gain: 0 },
          envelopes: [FLAT, { attack: 0.05, hold: 0, decay: 0.2, sustain: 0, release: 0 }, FLAT],
          routes: [{ source: 1, param: 'cutoff', amount: 3, min: 20, max: 16000, scale: 'log' }],
        }
      ),
    ],
  }),
  oscScene('wavetable, LFOs on the wave, the gain and the cutoff, ENV 2 on a Rate', {
    frames: OSC_RATE / 2,
    tables: { a: [saw(2048, 200), saw(1024, 300, 0.7), saw(2048, 50)] },
    lfos: [
      lfo('sine'),
      lfo('square', { mode: 1, smooth: 0.01, anchor: { time: 0, phase: 0.3, period: 0.13 } }),
      lfo('triangle', { delay: 0.05, rise: 0.1, phase: 0.25 }),
      lfo('saw-down'),
    ],
    voices: [
      note([{ table: 'a', unison: 3, phase: 0, phaseRand: 0 }, null], { frequency: 220, spread1: 12 }, [], {
        envelopes: [FLAT, { attack: 0.1, hold: 0, decay: 0.1, sustain: 0.4, release: 0.1 }, FLAT],
        filter: { type: 'lowpass', cutoff: 1500, resonance: 4, gain: 0 },
        routes: [
          { source: 4, param: 'position1', amount: 1, min: 0, max: 1 },
          { source: 5, param: 'gain1', amount: 0.6, min: 0, max: 1, bipolar: true },
          { source: 6, param: 'cutoff', amount: 2, min: 20, max: 16000, scale: 'log' },
          { source: 1, param: 'lfo1.rate', amount: 1.5, min: 1 / 32, max: 100, scale: 'log' },
        ],
      }),
    ],
  }),
];

export const SCENES = [
  {
    name: 'limiter, a chord 12 dB over',
    module: 'limiter',
    processor: 'waveform-limiter',
    options: STEREO,
    frames: RATE / 2,
    amplitude: 2,
    create: (dsp, wasm) => dsp.createLimiterWasm(wasm.limiter, RATE),
  },
  {
    name: 'reverb, the 70s era',
    module: 'reverb',
    processor: 'waveform-reverb',
    options: { ...STEREO, processorOptions: { params: REVERB, active: true } },
    frames: RATE,
    amplitude: 0.5,
    create: (dsp, wasm) => dsp.createReverbWasm(wasm.reverb, RATE, { params: REVERB, active: true }),
  },
  ...[0, 1].map((mode) => ({
    name: `distortion, ${mode ? 'hard' : 'soft'} clip at 9 dB, tone 6 kHz`,
    module: 'distortion',
    processor: 'waveform-distortion',
    options: { ...STEREO, processorOptions: { params: { mode, drive: 9, tone: 6000, level: -2 } } },
    frames: RATE / 2,
    amplitude: 0.6,
    create: (dsp, wasm) =>
      dsp.createDistortionWasm(wasm.distortion, RATE, { params: { mode, drive: 9, tone: 6000, level: -2 } }),
  })),
]
  .map((scene) => ({ rate: RATE, ...scene }))
  .concat(OSC_SCENES);

const ENTRY = `
export { createLimiterWasm } from './apps/waveform/src/app/synth/common/limiter/limiter-wasm';
export { createReverbWasm } from './apps/waveform/src/app/synth/fx/effects/reverb-wasm';
export { createDistortionWasm } from './apps/waveform/src/app/synth/fx/effects/distortion-wasm';
export {
  createOscScope,
  createTableStoreWasm,
  createVoiceSharedWasm,
  createVoiceWasm,
} from './apps/waveform/src/app/synth/common/wavetable/wavetable-osc-wasm';
export { buildLevels } from './apps/waveform/src/app/synth/common/wavetable/wavetable-mipmap';
export { VOICE_PARAMETERS } from './apps/waveform/src/app/synth/common/wavetable/wavetable-osc-params';
export { lfoTable } from './apps/waveform/src/app/synth/common/lfo/lfo-curve';
`;
let loaded = null;
const load = async () => {
  if (loaded) return loaded;
  const dsp = await loadApp({ contents: ENTRY, name: 'wasm-browsers' });
  const wasm = Object.fromEntries(
    ['limiter', 'reverb', 'distortion', 'wavetable-osc'].map((name) => [
      name,
      new WebAssembly.Instance(
        new WebAssembly.Module(fs.readFileSync(path.join(root, `tmp/wasm/${name}.wasm`)))
      ).exports,
    ])
  );
  loaded = { dsp, wasm };
  return loaded;
};

// the LFOs of an oscillator scene as a state at once (null: none), their tables as arrays (the page makes them
// Float32Arrays again)
export const sceneLfos = async (scene) => {
  if (!scene.lfos) return null;
  const { dsp } = await load();
  return {
    at: 0,
    instantly: true,
    lfos: scene.lfos.map(({ shape, ...wire }) => ({ ...wire, table: Array.from(dsp.lfoTable(shape)) })),
  };
};

// the levels of the tables of an oscillator scene (the page gets them as they are)
export const sceneLevels = async (scene) => {
  const { dsp } = await load();
  return Object.fromEntries(
    Object.entries(scene.tables).map(([table, frames]) => [table, dsp.buildLevels(frames)])
  );
};

// the voices of an oscillator scene in Node: the params of a block as the browser gives them (one value, or 128
// where the gate changes in the block)
const nodeOscRender = async (scene) => {
  const { dsp, wasm } = await load();
  const scope = dsp.createOscScope(wasm['wavetable-osc']);
  const store = dsp.createTableStoreWasm(scope);
  Object.entries(await sceneLevels(scene)).forEach(([table, levels]) => store.set(table, 1, levels));
  const shared = dsp.createVoiceSharedWasm(scope);
  const lfos = await sceneLfos(scene);
  if (lfos)
    shared.setLfos({
      ...lfos,
      lfos: lfos.lfos.map((wire) => ({ ...wire, table: Float32Array.from(wire.table) })),
    });
  const voices = scene.voices.map((voice) => ({
    ...voice,
    dsp: dsp.createVoiceWasm(scope, scene.rate, voice.options, store, Math.random, shared),
    ended: false,
  }));
  // the channels of each voice apart (the page splits them so too: no sum of the voices to compare)
  const output = voices.flatMap(() => [new Float32Array(scene.frames), new Float32Array(scene.frames)]);
  const [outL, outR] = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  for (let at = 0; at < scene.frames; at += BLOCK) {
    voices.forEach((voice, v) => {
      if (voice.ended) return;
      const params = Object.fromEntries(
        dsp.VOICE_PARAMETERS.map(({ name, defaultValue }) => [
          name,
          Float32Array.of(voice.params[name] ?? defaultValue),
        ])
      );
      const gateAt = (frame) => voice.gate.reduce((value, [from, v]) => (frame >= from ? v : value), 1);
      if (voice.gate.some(([from]) => from > at && from < at + BLOCK))
        params.gate = Float32Array.from({ length: BLOCK }, (_, i) => gateAt(at + i));
      else params.gate = Float32Array.of(gateAt(at));
      voice.ended = !voice.dsp.process(at, params, outL, outR);
      output[2 * v].set(outL, at);
      output[2 * v + 1].set(outR, at);
    });
  }
  return { output };
};

// the input of a scene and the output of its wasm core in Node, block by block
export const nodeRender = async (scene) => {
  if (scene.kind === 'osc') return nodeOscRender(scene);
  const { dsp, wasm } = await load();
  const input = signal(scene.frames, scene.amplitude);
  const core = scene.create(dsp, wasm);
  const output = [new Float32Array(scene.frames), new Float32Array(scene.frames)];
  for (let at = 0; at < scene.frames; at += BLOCK) {
    const block = (data) => data.subarray(at, at + BLOCK);
    core.process(block(input[0]), block(input[1]), block(output[0]), block(output[1]));
  }
  core.free?.();
  return { input, output };
};
