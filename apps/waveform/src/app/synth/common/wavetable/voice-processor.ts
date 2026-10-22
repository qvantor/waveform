import type {
  VoiceEndedMessage,
  VoiceFilterMessage,
  VoiceFilterOptions,
  VoiceOptions,
  VoiceRoute,
  VoiceRoutesMessage,
  VoiceStartedMessage,
} from './voice-options';
import { VOICE_PARAMETERS, VoiceParam } from './wavetable-osc-params';

// the voice processor of the wavetable oscillator worklet (wavetable-osc.worklet.ts): no import of the core, the
// worklet passes its voices. It runs in the AudioWorkletGlobalScope: no window, document or React

declare const currentFrame: number;
export interface AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const AudioWorkletProcessor: { prototype: AudioWorkletProcessor; new (): AudioWorkletProcessor };
declare function registerProcessor(
  name: string,
  processor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;

// what a core gives a voice (createVoiceDsp, createVoiceWasm)
export interface VoiceDsp {
  process: (
    frame: number,
    params: Record<VoiceParam, Float32Array>,
    outL: Float32Array,
    outR: Float32Array
  ) => boolean;
  setRoutes: (routes: VoiceRoute[]) => void;
  setFilter: (filter: VoiceFilterOptions | null) => void;
  end: () => void;
  readonly startedAt: number;
  startFrame: number;
}

// a node of one output (2 channels) has both; a missing one renders into this
let scratch = new Float32Array(128);

export const registerVoiceProcessor = (name: string, createDsp: (options: VoiceOptions) => VoiceDsp) => {
  class VoiceProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return VOICE_PARAMETERS;
    }

    private dsp: VoiceDsp;
    // posts the frames of its start once, at its first block: traced (VoiceOptions.trace), a voice of mono
    // (VoiceOptions.mono: the main thread works out the starts again it made before it knows where the voice
    // started), or started after them (its node came late: the fx and Poly follow its first sample)
    private report: boolean;
    private reported = false;

    constructor(options: AudioWorkletNodeOptions) {
      super();
      const voiceOptions = options.processorOptions as VoiceOptions;
      this.dsp = createDsp(voiceOptions);
      this.report = (__PERF__ && !!voiceOptions.trace) || !!voiceOptions.mono;
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
        if (!this.reported) {
          const { startedAt, startFrame } = this.dsp;
          if (startedAt >= 0) {
            this.reported = true;
            const started: VoiceStartedMessage = { started: startedAt, scheduled: startFrame };
            if (this.report || startedAt > startFrame) this.port.postMessage(started);
          }
        }
        if (playing) return true;
      } catch (error) {
        // a voice that throws ends like one released: it gives its tables back to the store (a processor that
        // failed would hold them for the life of the context) and its node is taken off the graph; the other
        // voices and the new notes play on
        console.error('A voice of the wavetable oscillator failed', error);
        try {
          this.dsp.end();
        } catch {
          // a core that trapped again: the voice ends all the same
        }
        outL.fill(0);
        output[1]?.fill(0);
      }
      const ended: VoiceEndedMessage = { ended: true };
      this.port.postMessage(ended);
      return false;
    }
  }

  registerProcessor(name, VoiceProcessor);
};
