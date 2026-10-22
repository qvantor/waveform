import bytes from '@waveform/wasm/wavetable-osc.wasm';
import { instantiateCore } from '../wasm/wasm-core';
import type { StoreStatsMessage, VoiceEvent, VoiceOptions } from './voice-options';
import {
  STORE_PROCESSOR,
  VOICE_PARAMETERS,
  VOICE_PROCESSOR,
  VOICES_PROCESSOR,
  VoiceParam,
} from './wavetable-osc-params';
import {
  createOscScope,
  createStoreReceiver,
  createTableStoreWasm,
  createVoiceScopeWasm,
  createVoiceSharedWasm,
  createVoiceWasm,
  OscExports,
  StoreFreedBytesMessage,
  VoiceScopeWasm,
} from './wavetable-osc-wasm';
import { registerVoiceProcessor } from './voice-processor';
import { registerVoicesProcessor } from './voices-processor';

// the audio worklet module of the wavetable oscillator with its Rust core (dsp/wavetable-osc), bundled by esbuild
// (`npm run worklets`) into assets/worklets/wavetable-osc.js with the bytes of wavetable-osc.wasm; it runs in
// the AudioWorkletGlobalScope (one per AudioContext): no window, document or React. One instance of the core for
// the scope: the store processor receives the tables into its memory (from the worker in chunks, or posted to its
// node), the voices processor plays them from there (every note in one node)

declare const sampleRate: number;
declare const currentFrame: number;
interface AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const AudioWorkletProcessor: { prototype: AudioWorkletProcessor; new (): AudioWorkletProcessor };
declare function registerProcessor(
  name: string,
  processor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;

const scope = createOscScope(instantiateCore<OscExports>(new WebAssembly.Module(bytes)));

// the functions of a block compile lazily, on their first call: while the module loads, a voice of both
// oscillators (the placeholder sine) on a store and a shared of its own renders a moving position (the direct
// path, the filter, a route), then a steady one (the mix builds, the pairs), and is freed with them (the first
// block of the first note 0.014 ms instead of 0.93 in Node, the module 2 ms longer: before the first note); then
// the same voice in a scope of voices, its params from events (a step, a target and ramps: the curves of the
// timelines), stolen at its end
const WARM_ENVELOPE = { attack: 0.001, hold: 0, decay: 0.01, sustain: 0.5, release: 0.01 };
const WARM_VOICE: VoiceOptions = {
  osc: [
    { table: '', unison: 4, phase: 0.5, phaseRand: 1 },
    { table: '', unison: 3, phase: 0, phaseRand: 0 },
  ],
  start: 0,
  envelopes: [WARM_ENVELOPE, WARM_ENVELOPE, WARM_ENVELOPE],
  envStart: 0,
  phrase: -1,
  routes: [{ env: 1, param: 'gain1', amount: -0.5, min: 0, max: 1 }],
  filter: { type: 'lowpass', cutoff: 4000, resonance: 3, gain: 0 },
};
const prewarm = () => {
  const warmStore = createTableStoreWasm(scope);
  const warmShared = createVoiceSharedWasm(scope);
  const voice = createVoiceWasm(scope, sampleRate, WARM_VOICE, warmStore, Math.random, warmShared);
  const [outL, outR] = [new Float32Array(128), new Float32Array(128)];
  const params = Object.fromEntries(
    VOICE_PARAMETERS.map(({ name, defaultValue }) => [name, Float32Array.of(defaultValue)])
  ) as Record<VoiceParam, Float32Array>;
  params.spread1 = Float32Array.of(20);
  params.spread2 = Float32Array.of(10);
  const moving = Float32Array.from({ length: 128 }, (_, i) => i / 128);
  for (let block = 0; block < 6; block++) {
    params.position1 = block < 2 ? moving : Float32Array.of(0.5);
    voice.process(block * 128, params, outL, outR);
  }
  voice.end();
  const voices = createVoiceScopeWasm(scope, sampleRate, warmStore, warmShared);
  const at = (block: number) => (block * 128) / sampleRate;
  const events: VoiceEvent[] = [
    { kind: 'on', voice: 0, options: WARM_VOICE, params: { spread1: 20, spread2: 10 } },
    { kind: 'set', voice: 0, param: 'frequency', value: 220, time: at(1) },
    { kind: 'ramp', voice: 0, param: 'frequency', value: 330, time: at(3) },
    { kind: 'cancel', voice: 0, param: 'position1', time: at(1) },
    { kind: 'target', voice: 0, param: 'position1', value: 0.5, time: at(1), constant: 0.0033 },
    { kind: 'set', voice: 0, param: 'position1', value: 0.5, time: at(3) },
    { kind: 'set', voice: 0, param: 'gate', value: -1, time: at(4) },
  ];
  voices.apply(events);
  for (let block = 0; block < 6; block++) {
    voices.process(block * 128, outL, outR);
    voices.reports();
  }
  voices.free();
  warmStore.free();
  warmShared.free();
};
prewarm();

const store = createTableStoreWasm(scope);
const shared = createVoiceSharedWasm(scope);
// the voices of the node of the context (the counters of the perf build read them)
let voices: VoiceScopeWasm | null = null;

class StoreProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // (the processor of a retry takes it over)
    store.listen((bytes) => {
      const freed: StoreFreedBytesMessage = { freedBytes: bytes };
      this.port.postMessage(freed);
    });
    this.port.onmessage = createStoreReceiver(
      store,
      (message) => this.port.postMessage(message),
      () => {
        // the counters of the store and of the voices of the scope (the perf build)
        if (!__PERF__) return;
        const { voices: scopeVoices, events } = voices?.stats() ?? { voices: 0, events: 0 };
        const answer: StoreStatsMessage = {
          stats: { ...store.stats(), ...shared.stats(), scopeVoices, events, frame: currentFrame },
        };
        this.port.postMessage(answer);
      }
    );
  }

  process() {
    return true;
  }
}

registerProcessor(STORE_PROCESSOR, StoreProcessor);
registerVoiceProcessor(VOICE_PROCESSOR, (options: VoiceOptions) =>
  createVoiceWasm(scope, sampleRate, options, store, Math.random, shared)
);
const voicesFailed = (error: unknown) => console.error('A voice of the wavetable oscillator failed', error);
registerVoicesProcessor(
  VOICES_PROCESSOR,
  () => {
    // (the node of a retry takes the counters over)
    const created = createVoiceScopeWasm(scope, sampleRate, store, shared, Math.random, voicesFailed);
    voices = created;
    return {
      ...created,
      free: () => {
        if (voices === created) voices = null;
        created.free();
      },
    };
  },
  voicesFailed
);
