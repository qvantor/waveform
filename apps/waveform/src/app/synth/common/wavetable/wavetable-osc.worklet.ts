import {
  createTableStore,
  createVoiceDsp,
  StatsRequest,
  StoreFreedMessage,
  StoreStatsMessage,
  StoreTableMessage,
  voiceStats,
} from './wavetable-osc-dsp';
import { STORE_PROCESSOR, VOICE_PROCESSOR } from './wavetable-osc-params';
import { registerVoiceProcessor } from './voice-processor';

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

registerProcessor(STORE_PROCESSOR, StoreProcessor);
registerVoiceProcessor(VOICE_PROCESSOR, (options) => createVoiceDsp(sampleRate, options, store));
