import { buildLevels } from '../app/synth/common/wavetable/wavetable-mipmap';
import {
  createTableStore,
  createVoiceDsp,
  createVoiceShared,
  TableStore,
  VoiceOptions,
  VoiceShared,
  VoiceStats,
} from '../app/synth/common/wavetable/wavetable-osc-dsp';
import type { EnvelopeParams } from '../app/synth/common/envelope/envelope-curve';
import { VoiceParam } from '../app/synth/common/wavetable/wavetable-osc-params';
import {
  createTableStoreWasm,
  createVoiceSharedWasm,
  createVoiceWasm,
  OscScope,
  TableStoreWasm,
  VoiceSharedWasm,
} from '../app/synth/common/wavetable/wavetable-osc-wasm';
import { seeded } from './seeded';

// the voice dsp of the wavetable oscillator run offline, as the worklet runs it: tables in a store, the
// voices of a scope one after another every block of 128 frames

export const BLOCK = 128;

// ENV 1 at full level from the start, ended at once by the gate, ENV 2 and 3 read by no route: the voice as
// the oscillators play it
const FLAT: EnvelopeParams = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };

// a seeded random() (mulberry32): the phases of a note are reproducible
export { seeded };

// a store with version 1 of each table (frames of samples), the levels it frees
export const storeWith = (tables: Record<string, number[][]>) => {
  const freed: unknown[] = [];
  const store = createTableStore((levels) => freed.push(levels));
  Object.entries(tables).forEach(([id, frames]) => store.set(id, 1, buildLevels(frames)));
  return { store, freed };
};

// the same in the store of the Rust core (in the instance `scope`)
export const wasmStoreWith = (scope: OscScope, tables: Record<string, number[][]>) => {
  const freed: unknown[] = [];
  const store = createTableStoreWasm(scope, (levels) => freed.push(levels));
  Object.entries(tables).forEach(([id, frames]) => store.set(id, 1, buildLevels(frames)));
  return { store, freed };
};

export const VOICE_DEFAULTS: Record<VoiceParam, number> = {
  frequency: 440,
  gate: 1,
  position1: 0,
  position2: 0,
  detune1: 0,
  detune2: 0,
  spread1: 0,
  spread2: 0,
  gain1: 1,
  gain2: 1,
};

// a param of a block: a number (constant over the block) or a function of the frame (one value per sample)
export type VoiceParamValue = number | ((frame: number) => number);
export type VoiceParams = Partial<Record<VoiceParam, VoiceParamValue>>;

const blockValues = (params: VoiceParams, frame: number) =>
  Object.fromEntries(
    (Object.keys(VOICE_DEFAULTS) as VoiceParam[]).map((name) => {
      const value = params[name] ?? VOICE_DEFAULTS[name];
      return [
        name,
        typeof value === 'number'
          ? Float32Array.of(value)
          : Float32Array.from({ length: BLOCK }, (_, i) => value(frame + i)),
      ];
    })
  ) as Record<VoiceParam, Float32Array>;

// a voice of either core
interface VoiceDsp {
  process: (
    frame: number,
    params: Record<VoiceParam, Float32Array>,
    outL: Float32Array,
    outR: Float32Array
  ) => boolean;
}

export interface ScopeVoice {
  dsp: VoiceDsp;
  // read every block: change them between blocks
  params: VoiceParams;
  ended: boolean;
}

// the voices of an AudioWorkletGlobalScope: add() a note (it starts at the frame of the next block unless
// options.start says otherwise), block() renders every voice alive for one block in the order they were
// added and returns the counters of the scope over it (the peak cost is the cost of the builds of the block)
export const createVoiceScope = ({
  rate,
  store,
  shared = createVoiceShared(),
  random = seeded(1),
}: {
  rate: number;
  store: TableStore;
  shared?: VoiceShared;
  random?: () => number;
}) => scopeOf(rate, shared, (options) => createVoiceDsp(rate, options, store, random, shared));

// the same with the voices of the Rust core (wavetable-osc-wasm.ts): its store and shared in the instance `scope`
export const createWasmVoiceScope = ({
  rate,
  scope,
  store,
  shared = createVoiceSharedWasm(scope),
  random = seeded(1),
}: {
  rate: number;
  scope: OscScope;
  store: TableStoreWasm;
  shared?: VoiceSharedWasm;
  random?: () => number;
}) => scopeOf(rate, shared, (options) => createVoiceWasm(scope, rate, options, store, random, shared));

const scopeOf = <Shared extends { stats: () => VoiceStats }>(
  rate: number,
  shared: Shared,
  createVoice: (options: VoiceOptions) => VoiceDsp
) => {
  const voices: ScopeVoice[] = [];
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  let frame = 0;
  let last = shared.stats();
  return {
    shared,
    voices,
    get frame() {
      return frame;
    },
    add: (osc: VoiceOptions['osc'], params: VoiceParams = {}, start = frame / rate) => {
      const voice: ScopeVoice = {
        // a phrase of its own: the voices of a scope are notes, not of a legato phrase
        dsp: createVoice({
          osc,
          start,
          envelopes: [FLAT, FLAT, FLAT],
          envStart: start,
          phrase: voices.length,
          routes: [],
          filter: null,
        }),
        // its own: a spec changes them for this voice
        params: { ...params },
        ended: false,
      };
      voices.push(voice);
      return voice;
    },
    block: (): VoiceStats => {
      voices.forEach((voice) => {
        if (voice.ended) return;
        voice.ended = !voice.dsp.process(frame, blockValues(voice.params, frame), outL, outR);
      });
      frame += BLOCK;
      const now = shared.stats();
      const delta = Object.fromEntries(
        (Object.keys(now) as (keyof VoiceStats)[]).map((key) => [
          key,
          key === 'peakCost' || key === 'voices' || key === 'unison' ? now[key] : now[key] - last[key],
        ])
      ) as unknown as VoiceStats;
      last = now;
      return delta;
    },
    alive: () => voices.filter(({ ended }) => !ended).length,
  };
};
