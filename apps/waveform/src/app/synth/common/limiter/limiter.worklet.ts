import { createLimiterDsp, LIMITER_PROCESSOR, LimiterMessage } from './limiter-dsp';

// the audio worklet module of the master limiter, bundled by esbuild (`npm run worklets`) into
// assets/worklets/limiter.js; it runs in the AudioWorkletGlobalScope: no window, document or React

declare const sampleRate: number;
interface AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const AudioWorkletProcessor: { prototype: AudioWorkletProcessor; new (): AudioWorkletProcessor };
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

// a disconnected input has no channels
let silence = new Float32Array(128);
const silent = (length: number) => {
  if (silence.length !== length) silence = new Float32Array(length);
  return silence;
};

class LimiterProcessor extends AudioWorkletProcessor {
  private dsp = createLimiterDsp(sampleRate);
  private stopped = false;

  constructor() {
    super();
    this.port.onmessage = ({ data }: MessageEvent<LimiterMessage>) => {
      if (data.stop) this.stopped = true;
    };
  }

  process([input]: Float32Array[][], [[outL, outR]]: Float32Array[][]) {
    if (this.stopped) return false;
    const inL = input[0] ?? silent(outL.length);
    this.dsp.process(inL, input[1] ?? inL, outL, outR);
    // the master output lives as long as the synth
    return true;
  }
}

registerProcessor(LIMITER_PROCESSOR, LimiterProcessor);
