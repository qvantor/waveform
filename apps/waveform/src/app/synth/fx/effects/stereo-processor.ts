import { createFxModulator, FxModMessage } from './fx-modulation';

// the processor of the audio worklet modules (reverb.worklet.ts, limiter.worklet.ts), bundled into each of
// them; it runs in the AudioWorkletGlobalScope: no window, document or React

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

// main thread → worklet: the node is destroyed (createWorkletFx), the processor ends, so it can be collected
export interface StopMessage {
  stop?: boolean;
}

export interface StereoDsp {
  process: (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array) => void;
  // a wasm core frees the state of the processor in its memory once it is stopped
  free?: () => void;
}

// a disconnected input has no channels
let silence = new Float32Array(128);
const silent = (length: number) => {
  if (silence.length !== length) silence = new Float32Array(length);
  return silence;
};

// registers the processor `name`: its dsp is created at the context rate with the node options and renders
// one input (a mono one feeds both sides) into the stereo output. onMessage gets the posted messages. It
// keeps running until it is stopped: the fx slot drains an effect, the master lives as long as the synth.
// An effect whose knobs follow the envelopes (fx-modulation.ts) gives `modulate`: the moved knobs are set
// through it once per block (their params messages don't reach onMessage), its node options have the knobs
// in processorOptions.params
export const registerStereoProcessor = <Dsp extends StereoDsp, Message extends object = StopMessage>(
  name: string,
  createDsp: (sampleRate: number, options: AudioWorkletNodeOptions) => Dsp,
  onMessage?: (dsp: Dsp, message: Message) => void,
  modulate?: (dsp: Dsp, values: Record<string, number>) => void
) => {
  class StereoProcessor extends AudioWorkletProcessor {
    private dsp: Dsp;
    private stopped = false;
    private modulator: ReturnType<typeof createFxModulator> | null = null;

    constructor(options: AudioWorkletNodeOptions) {
      super();
      this.dsp = createDsp(sampleRate, options);
      if (modulate) {
        const { params = {} } = (options.processorOptions ?? {}) as { params?: Record<string, number> };
        this.modulator = createFxModulator(sampleRate, params);
      }
      this.port.onmessage = ({ data }: MessageEvent<Message & StopMessage & FxModMessage>) => {
        const { modulator } = this;
        let message = data;
        if (modulator && data.mod !== undefined) modulator.set(data.mod);
        const { params } = data as { params?: Record<string, number> };
        if (modulator && params) message = { ...data, params: modulator.bases(params) ?? undefined };
        onMessage?.(this.dsp, message);
        if (data.stop && !this.stopped) {
          this.stopped = true;
          this.dsp.free?.();
        }
      };
    }

    process([input]: Float32Array[][], [[outL, outR]]: Float32Array[][]) {
      if (this.stopped) return false;
      const values = this.modulator?.block(currentFrame);
      if (values && modulate) modulate(this.dsp, values);
      const inL = input[0] ?? silent(outL.length);
      this.dsp.process(inL, input[1] ?? inL, outL, outR);
      return true;
    }
  }

  registerProcessor(name, StereoProcessor);
};
