import bytes from '@waveform/wasm/wavetable-osc.wasm';
import { lfoTable, LfosState, RETRIG } from '../lfo/lfo-curve';
import { instantiateCore } from '../wasm/wasm-core';
import type { StoreStatsMessage, VoiceEvent, VoiceOptions } from './voice-options';
import { createLevels, levelBase } from './wavetable-levels';
import { STORE_PROCESSOR, VOICE_PARAMETERS, VOICES_PROCESSOR, VoiceParam } from './wavetable-osc-params';
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
// oscillators (a table of 2 frames and the placeholder sine) on a store and a shared of its own renders a moving
// position (the direct path, the fades from a frame into the other at three pitches, the filter, a route of an
// envelope, of the velocity and of an LFO, its amp, the routes of the knobs of the LFO: a new Phase glides, a new
// shape crossfades), then a steady one (the mix builds, the pairs), and is freed with them (the first block of the
// first note 0.014 ms instead of 0.93 in Node, the module 2 ms longer: before the first note); then the same voice
// in a scope of voices, its params from events (a step, a target and ramps: the curves of the timelines), its
// velocity gliding to another one, bent (the pitch bend of the node, gliding), stolen at its end
const WARM_ENVELOPE = { attack: 0.001, hold: 0, decay: 0.01, sustain: 0.5, release: 0.01 };
const WARM_VOICE: VoiceOptions = {
  osc: [
    { table: 'warm', unison: 4, phase: 0.5, phaseRand: 1 },
    { table: '', unison: 3, phase: 0, phaseRand: 0 },
  ],
  start: 0,
  envelopes: [WARM_ENVELOPE, WARM_ENVELOPE, WARM_ENVELOPE],
  envStart: 0,
  phrase: -1,
  routes: [
    { source: 1, param: 'gain1', amount: -0.5, min: 0, max: 1 },
    { source: 3, param: 'gain2', amount: 0.25, min: 0, max: 1 },
    // (LFO 1 on a gain: the voice stays on its mix tables)
    { source: 4, param: 'gain1', amount: 0.25, min: 0, max: 1 },
    { source: 1, param: 'lfo1.rate', amount: 0.5, min: 1 / 32, max: 100, scale: 'log' },
    { source: 1, param: 'lfo1.smooth', amount: 0.25, min: 0, max: 1, scale: 'pow' },
    { source: 1, param: 'lfo1.phase', amount: 0.25, min: 0, max: 1 },
  ],
  filter: { type: 'lowpass', cutoff: 4000, resonance: 3, gain: 0 },
  velocity: { level: 0.5, amp: 0.75 },
};
// LFO 1 a square of 50 ms in its Delay for a block (a flat block), its Rise and Smooth; then another Phase (it
// glides: the bases of its knobs per sample) and another shape (a crossfade)
const warmLfos = (at: number, phase: number, shape: 'square' | 'triangle', instantly = false): LfosState => ({
  at,
  instantly,
  lfos: [0, 1, 2, 3].map((lfo) => ({
    mode: RETRIG,
    delay: lfo === 0 ? 0.003 : 0,
    rise: 0.005,
    smooth: 0.002,
    phase,
    anchor: { time: 0, phase: 0, period: 0.05 },
    ...(lfo === 0 && { table: lfoTable(shape) }),
  })),
});
const prewarm = () => {
  const warmStore = createTableStoreWasm(scope);
  // two frames of silence of 32 harmonics, on levels of 1024 samples, of 512 from level 6: by the pitch a fade
  // between them reads one level (x = 1 + 3·log2(base·f / nyquist) below 0), two of one length (0.5) or of two
  // lengths (5.5)
  warmStore.set('warm', 1, createLevels(2, 32));
  const pitches = [-1, 0.5, 5.5].map((x) => (sampleRate / 2 / levelBase(32)) * 2 ** ((x - 1) / 3));
  const warmShared = createVoiceSharedWasm(scope);
  warmShared.setLfos(warmLfos(0, 0, 'square', true));
  const voice = createVoiceWasm(scope, sampleRate, WARM_VOICE, warmStore, Math.random, warmShared);
  const [outL, outR] = [new Float32Array(128), new Float32Array(128)];
  const params = Object.fromEntries(
    VOICE_PARAMETERS.map(({ name, defaultValue }) => [name, Float32Array.of(defaultValue)])
  ) as Record<VoiceParam, Float32Array>;
  params.spread1 = Float32Array.of(20);
  params.spread2 = Float32Array.of(10);
  // up and down across the frames at each pitch, a block apart (a fade lasts up to 5 ms), then still
  const up = Float32Array.from({ length: 128 }, (_, i) => i / 128);
  const down = up.map((value) => 1 - value);
  for (let block = 0; block < 10; block++) {
    if (block === 3) warmShared.setLfos(warmLfos((4 * 128) / sampleRate, 0.5, 'triangle'));
    params.frequency = Float32Array.of(pitches[Math.min(2, block >> 1)]);
    params.position1 = block < 6 ? (block % 4 < 2 ? up : down) : Float32Array.of(0.5);
    voice.process(block * 128, params, outL, outR);
  }
  voice.end();
  const voices = createVoiceScopeWasm(scope, sampleRate, warmStore, warmShared);
  const at = (block: number) => (block * 128) / sampleRate;
  const events: VoiceEvent[] = [
    { kind: 'lfos', ...warmLfos(0, 0, 'square', true) },
    { kind: 'lfos', ...warmLfos(at(2), 0.5, 'triangle') },
    { kind: 'on', voice: 0, options: WARM_VOICE, params: { spread1: 20, spread2: 10 } },
    { kind: 'set', voice: 0, param: 'frequency', value: 220, time: at(1) },
    { kind: 'ramp', voice: 0, param: 'frequency', value: 330, time: at(3) },
    { kind: 'cancel', voice: 0, param: 'position1', time: at(1) },
    { kind: 'target', voice: 0, param: 'position1', value: 0.5, time: at(1), constant: 0.0033 },
    { kind: 'set', voice: 0, param: 'position1', value: 0.5, time: at(3) },
    { kind: 'velocity', voices: [0], velocity: { level: 1, amp: 1 } },
    { kind: 'bend', cents: 200 },
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
