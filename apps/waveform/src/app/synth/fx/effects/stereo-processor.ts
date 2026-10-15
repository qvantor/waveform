// the processor of the audio worklet modules (reverb.worklet.ts, limiter.worklet.ts), bundled into each of
// them; it runs in the AudioWorkletGlobalScope: no window, document or React

declare const sampleRate: number;
interface AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const AudioWorkletProcessor: { prototype: AudioWorkletProcessor; new (): AudioWorkletProcessor };
declare function registerProcessor(
  name: string,
  processor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;

// main thread → worklet: the node is destroyed (createWorkletFx), the processor ends, so it can be collected
export interface StopMessage {
  stop?: boolean;
}

export interface StereoDsp {
  process: (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array) => void;
}

// a disconnected input has no channels
let silence = new Float32Array(128);
const silent = (length: number) => {
  if (silence.length !== length) silence = new Float32Array(length);
  return silence;
};

// registers the processor `name`: its dsp is created at the context rate with the node options and renders
// one input (a mono one feeds both sides) into the stereo output. onMessage gets the posted messages. It
// keeps running until it is stopped: the fx slot drains an effect, the master lives as long as the synth
export const registerStereoProcessor = <Dsp extends StereoDsp, Message extends object = StopMessage>(
  name: string,
  createDsp: (sampleRate: number, options: AudioWorkletNodeOptions) => Dsp,
  onMessage?: (dsp: Dsp, message: Message) => void
) => {
  class StereoProcessor extends AudioWorkletProcessor {
    private dsp: Dsp;
    private stopped = false;

    constructor(options: AudioWorkletNodeOptions) {
      super();
      this.dsp = createDsp(sampleRate, options);
      this.port.onmessage = ({ data }: MessageEvent<Message & StopMessage>) => {
        onMessage?.(this.dsp, data);
        if (data.stop) this.stopped = true;
      };
    }

    process([input]: Float32Array[][], [[outL, outR]]: Float32Array[][]) {
      if (this.stopped) return false;
      const inL = input[0] ?? silent(outL.length);
      this.dsp.process(inL, input[1] ?? inL, outL, outR);
      return true;
    }
  }

  registerProcessor(name, StereoProcessor);
};
