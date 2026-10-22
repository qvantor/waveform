import type { StopMessage } from '../../fx/effects/stereo-processor';
import type { VoiceEvent, VoiceEventsMessage, VoicesReportMessage } from './voice-options';

// the processor of the voices of the wavetable oscillator worklet (wavetable-osc.worklet.ts), one node per
// context: every note plays in it. No import of the core, the worklet passes its voices. It runs in the
// AudioWorkletGlobalScope: no window, document or React

declare const currentFrame: number;
interface AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const AudioWorkletProcessor: { prototype: AudioWorkletProcessor; new (): AudioWorkletProcessor };
declare function registerProcessor(
  name: string,
  processor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;

// what a core gives the voices of a node (createVoiceScopeWasm)
export interface VoicesDsp {
  apply: (events: VoiceEvent[]) => void;
  process: (frame: number, outL: Float32Array, outR: Float32Array) => void;
  reports: () => VoicesReportMessage | null;
  tap: (on: boolean) => void;
  taps: (n: number) => { voice: number; left: Float32Array; right: Float32Array }[];
  free: () => void;
}

export interface VoicesProcessorOptions {
  // the events of a scene, before its first block (a message to an OfflineAudioContext comes in a block no one can
  // tell)
  events?: VoiceEvent[];
  // each voice into a pair of channels of its own, in the order they were made (the parity of the browsers; the
  // node has 2 channels a voice)
  tap?: boolean;
}

// a node of one output (2 channels) has both; a missing one renders into this
let scratch = new Float32Array(128);
let sum = [new Float32Array(128), new Float32Array(128)];

// registers the processor `name`: the events of the main thread come in order, a block renders every voice into
// the output and posts the starts and the ends it had (none: nothing). `onError` hears what a message broke. It
// plays until it is stopped (its voices end, their tables go back to the store)
export const registerVoicesProcessor = (
  name: string,
  createDsp: () => VoicesDsp,
  onError: (error: unknown) => void
) => {
  class VoicesProcessor extends AudioWorkletProcessor {
    private dsp: VoicesDsp | null;
    // the pair of channels of each voice (tap)
    private pairs: Map<number, number> | null = null;

    constructor(options: AudioWorkletNodeOptions) {
      super();
      const { events, tap } = (options.processorOptions ?? {}) as VoicesProcessorOptions;
      const dsp = createDsp();
      this.dsp = dsp;
      if (tap) {
        this.pairs = new Map();
        dsp.tap(true);
      }
      if (events) dsp.apply(events);
      this.port.onmessage = ({ data }: MessageEvent<VoiceEventsMessage & StopMessage>) => {
        if (!this.dsp) return;
        if (data.stop) {
          this.dsp.free();
          this.dsp = null;
          return;
        }
        try {
          this.dsp.apply(data.events);
        } catch (error) {
          // (a trap of the core outside a voice: the events after it are lost, the voices play on)
          onError(error);
        }
      };
    }

    process(_inputs: Float32Array[][], [output]: Float32Array[][]) {
      const { dsp, pairs } = this;
      if (!dsp) return false;
      const n = output[0].length;
      if (scratch.length !== n) {
        scratch = new Float32Array(n);
        sum = [new Float32Array(n), new Float32Array(n)];
      }
      if (!pairs) dsp.process(currentFrame, output[0], output[1] ?? scratch);
      else {
        dsp.process(currentFrame, sum[0], sum[1]);
        output.forEach((channel) => channel.fill(0));
        dsp.taps(n).forEach(({ voice, left, right }) => {
          const pair = pairs.get(voice) ?? pairs.size;
          pairs.set(voice, pair);
          output[2 * pair]?.set(left);
          output[2 * pair + 1]?.set(right);
        });
      }
      const report = dsp.reports();
      if (report) this.port.postMessage(report);
      return true;
    }
  }

  registerProcessor(name, VoicesProcessor);
};
