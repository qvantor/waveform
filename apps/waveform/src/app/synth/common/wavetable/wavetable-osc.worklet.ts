import {
  createTableStore,
  createVoiceDsp,
  StoreFreedMessage,
  StoreTableMessage,
  VoiceEndedMessage,
  VoiceOptions,
} from './wavetable-osc-dsp';
import { STORE_PROCESSOR, VOICE_PARAMETERS, VOICE_PROCESSOR, VoiceParam } from './wavetable-osc-params';

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
    const receive = ({ data }: MessageEvent<StoreTableMessage | StorePortMessage>) => {
      if ('port' in data) {
        workerPort = data.port;
        workerPort.onmessage = receive;
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

  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.dsp = createVoiceDsp(sampleRate, options.processorOptions as VoiceOptions, store);
  }

  process(
    _inputs: Float32Array[][],
    [output]: Float32Array[][],
    parameters: Record<VoiceParam, Float32Array>
  ) {
    const outL = output[0];
    if (scratch.length !== outL.length) scratch = new Float32Array(outL.length);
    if (this.dsp.process(currentFrame, parameters, outL, output[1] ?? scratch)) return true;
    const ended: VoiceEndedMessage = { ended: true };
    this.port.postMessage(ended);
    return false;
  }
}

registerProcessor(STORE_PROCESSOR, StoreProcessor);
registerProcessor(VOICE_PROCESSOR, VoiceProcessor);
