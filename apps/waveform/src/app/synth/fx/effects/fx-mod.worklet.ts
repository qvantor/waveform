import { lateState } from '../../common/lfo/lfo-curve';
import { FX_MOD_PROCESSOR } from '../../common/processors';
import { createFxModLines } from './fx-mod-lines';
import type { FxModMessage, FxModOptions } from './fx-mod-params';

// the audio worklet module of the lines the knobs of the native nodes follow (the delay, the mix of every slot),
// bundled by esbuild (`npm run worklets`) into assets/worklets/fx-mod.js: no core, the lines of fx-mod-lines.ts. It
// runs in the AudioWorkletGlobalScope: no window, document or React

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

class FxModProcessor extends AudioWorkletProcessor {
  private lines: ReturnType<typeof createFxModLines>;
  private stopped = false;
  // the channel of each output
  private channels: Float32Array[] = [];
  // the frame of the next block (none before the first one): a state of the LFOs that comes after its time takes
  // over then (lateState)
  private next = -Infinity;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.lines = createFxModLines(sampleRate, options.processorOptions as FxModOptions | undefined);
    this.port.onmessage = ({ data }: MessageEvent<FxModMessage>) => {
      if (this.stopped) return;
      const { lines } = this;
      if (data.lfos) lines.setLfos(lateState(data.lfos, this.next / sampleRate));
      if (data.knobRoutes) lines.setKnobRoutes(data.knobRoutes);
      if (data.note !== undefined) lines.setNote(data.note);
      if (data.line) lines.setLine(...data.line);
      if (data.stop) this.stopped = true;
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    if (this.stopped) return false;
    const { channels } = this;
    for (let k = 0; k < outputs.length; k++) channels[k] = outputs[k][0];
    this.next = currentFrame + (channels[0]?.length ?? 128);
    this.lines.process(currentFrame, channels);
    return true;
  }
}

registerProcessor(FX_MOD_PROCESSOR, FxModProcessor);
