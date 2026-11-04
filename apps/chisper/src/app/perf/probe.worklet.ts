import {
  createOnsetDetector,
  PROBE_DEFAULTS,
  PROBE_PROCESSOR,
  ProbeOnsetMessage,
  ProbeOptions,
} from './probe-dsp';

// the onset probe of the perf build: not in `npm run worklets` (it would ship), the perf runner bundles it and
// the test hook adds it (perf-api.ts). Each input posts the frame of its onsets; its output is silence, so the
// node is pulled without changing the mix

declare const currentFrame: number;
interface AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const AudioWorkletProcessor: { prototype: AudioWorkletProcessor; new (): AudioWorkletProcessor };
declare function registerProcessor(
  name: string,
  processor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;

class ProbeProcessor extends AudioWorkletProcessor {
  private detectors: ReturnType<typeof createOnsetDetector>[];
  private stopped = false;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const config: ProbeOptions = {
      ...PROBE_DEFAULTS,
      ...(options.processorOptions as Partial<ProbeOptions>),
    };
    this.detectors = Array.from({ length: options.numberOfInputs ?? 2 }, () => createOnsetDetector(config));
    this.port.onmessage = ({ data }: MessageEvent<{ stop?: boolean }>) => {
      if (data.stop) this.stopped = true;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    if (this.stopped) return false;
    const length = outputs[0]?.[0]?.length ?? 128;
    inputs.forEach((channels, input) => {
      const onset = this.detectors[input]?.(channels, length) ?? -1;
      if (onset < 0) return;
      const message: ProbeOnsetMessage = { onset: currentFrame + onset, input };
      this.port.postMessage(message);
    });
    outputs.forEach((channels) => channels.forEach((channel) => channel.fill(0)));
    return true;
  }
}

registerProcessor(PROBE_PROCESSOR, ProbeProcessor);
