import {
  createTableStore,
  createVoiceDsp,
  StatsRequest,
  StoreFreedMessage,
  StoreStatsMessage,
  StoreTableMessage,
  VoiceEndedMessage,
  VoiceOptions,
  VoiceStartedMessage,
  voiceStats,
} from './wavetable-osc-dsp';
import { STORE_PROCESSOR, VOICE_PARAMETERS, VOICE_PROCESSOR, VoiceParam } from './wavetable-osc-params';
import type { VoiceRoutesMessage } from './voice-modulation';
import type { VoiceFilterMessage } from './voice-filter';

// the audio worklet module of the wavetable oscillator, bundled by esbuild (`npm run worklets`) into
// assets/worklets/wavetable-osc.js; it runs in the AudioWorkletGlobalScope (one per AudioContext): no window,
// document or React. The store processor receives the tables (from the worker through a MessagePort of
// its own, or posted to its node), the voice processors of the context read them from the same store

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

// main thread → store: the port of the worker (a MessageChannel), the tables come through it
export interface StorePortMessage {
  port: MessagePort;
}
// store → main thread: a version is in the store, new voices play it
export interface StoreStoredMessage {
  stored: string;
  version: number;
}

let workerPort: MessagePort | null = null;
// a version no voice plays anymore goes back to the worker, which reuses its buffer: the audio thread never
// collects it
const store = createTableStore((levels) => {
  const freed: StoreFreedMessage = { freed: levels.data.buffer };
  workerPort?.postMessage(freed, [levels.data.buffer]);
});

class StoreProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const receive = ({ data }: MessageEvent<StoreTableMessage | StorePortMessage | StatsRequest>) => {
      if ('port' in data) {
        workerPort = data.port;
        workerPort.onmessage = receive;
        return;
      }
      if ('stats' in data) {
        // the counters of the store and of the voices of the scope (the perf build)
        if (!__PERF__) return;
        const answer: StoreStatsMessage = {
          stats: { ...store.stats(), ...voiceStats(), frame: currentFrame },
        };
        this.port.postMessage(answer);
        return;
      }
      if (data.remove) store.remove(data.table);
      else if (data.levels) store.set(data.table, data.version, data.levels);
      const stored: StoreStoredMessage = { stored: data.table, version: data.version };
      this.port.postMessage(stored);
    };
    this.port.onmessage = receive;
  }

  process() {
    return true;
  }
}

// a node of one output (2 channels) has both; a missing one renders into this
let scratch = new Float32Array(128);

class VoiceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return VOICE_PARAMETERS;
  }

  private dsp: ReturnType<typeof createVoiceDsp>;
  // posts the frames of its start once: traced (VoiceOptions.trace), or started after them (its node came
  // late: the fx and Poly follow its first sample)
  private trace: boolean;
  private reported = false;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const voiceOptions = options.processorOptions as VoiceOptions;
    this.dsp = createVoiceDsp(sampleRate, voiceOptions, store);
    this.trace = __PERF__ && !!voiceOptions.trace;
    this.port.onmessage = ({ data }: MessageEvent<Partial<VoiceRoutesMessage & VoiceFilterMessage>>) => {
      if (data.routes) this.dsp.setRoutes(data.routes);
      if (data.filter !== undefined) this.dsp.setFilter(data.filter);
    };
  }

  process(
    _inputs: Float32Array[][],
    [output]: Float32Array[][],
    parameters: Record<VoiceParam, Float32Array>
  ) {
    const outL = output[0];
    if (scratch.length !== outL.length) scratch = new Float32Array(outL.length);
    try {
      const playing = this.dsp.process(currentFrame, parameters, outL, output[1] ?? scratch);
      const { startedAt, startFrame } = this.dsp;
      if (!this.reported && startedAt >= 0) {
        this.reported = true;
        const started: VoiceStartedMessage = { started: startedAt, scheduled: startFrame };
        if (this.trace || startedAt > startFrame) this.port.postMessage(started);
      }
      if (playing) return true;
    } catch (error) {
      // a voice that throws ends like one released: it gives its tables back to the store (a processor that
      // failed would hold them for the life of the context) and its node is taken off the graph; the other
      // voices and the new notes play on
      console.error('A voice of the wavetable oscillator failed', error);
      this.dsp.end();
      outL.fill(0);
      output[1]?.fill(0);
    }
    const ended: VoiceEndedMessage = { ended: true };
    this.port.postMessage(ended);
    return false;
  }
}

registerProcessor(STORE_PROCESSOR, StoreProcessor);
registerProcessor(VOICE_PROCESSOR, VoiceProcessor);
