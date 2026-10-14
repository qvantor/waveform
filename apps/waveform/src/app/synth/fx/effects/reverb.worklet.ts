import { createReverbDsp, REVERB_PROCESSOR, ReverbMessage, ReverbOptions } from './reverb-dsp';

// the audio worklet module of the reverb, bundled by esbuild (`npm run worklets`) into
// assets/worklets/reverb.js; it runs in the AudioWorkletGlobalScope: no window, document or React

declare const sampleRate: number;
interface AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const AudioWorkletProcessor: { prototype: AudioWorkletProcessor; new (): AudioWorkletProcessor };
declare function registerProcessor(
  name: string,
  processor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;

// a disconnected input has no channels
let silence = new Float32Array(128);
const silent = (length: number) => {
  if (silence.length !== length) silence = new Float32Array(length);
  return silence;
};

class ReverbProcessor extends AudioWorkletProcessor {
  private dsp: ReturnType<typeof createReverbDsp>;
  private stopped = false;

  constructor({ processorOptions }: AudioWorkletNodeOptions) {
    super();
    this.dsp = createReverbDsp(sampleRate, processorOptions as ReverbOptions);
    this.port.onmessage = ({ data }: MessageEvent<ReverbMessage>) => {
      if (data.params) this.dsp.set(data.params);
      if (data.active !== undefined) this.dsp.setActive(data.active);
      if (data.stop) this.stopped = true;
    };
  }

  process([input]: Float32Array[][], [[outL, outR]]: Float32Array[][]) {
    if (this.stopped) return false;
    const inL = input[0] ?? silent(outL.length);
    this.dsp.process(inL, input[1] ?? inL, outL, outR);
    // the slot keeps the node rendered (drain), so it lives until the effect is destroyed
    return true;
  }
}

registerProcessor(REVERB_PROCESSOR, ReverbProcessor);
