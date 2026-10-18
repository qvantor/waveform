// the onset probe of the perf build (probe.worklet.ts, perf-api.ts): where a sound starts after silence, to
// the sample; no imports, the worklet bundles it

export const PROBE_PROCESSOR = 'waveform-perf-probe';

export interface ProbeOptions {
  // the level a sample crosses to start an onset, the samples under it before (a sound that goes on is no onset)
  threshold: number;
  quiet: number;
}
export const PROBE_DEFAULTS: ProbeOptions = { threshold: 1e-3, quiet: 512 };

// probe → main thread: an input of the probe crossed the threshold after silence at that frame
export interface ProbeOnsetMessage {
  onset: number;
  input: number;
}

// the index of the onset in a block (any channel over the threshold), -1 without one; it starts armed (the
// silence before the first block), a disconnected input (no channels) is silence
export const createOnsetDetector = ({ threshold, quiet }: ProbeOptions) => {
  let silent = quiet;
  return (channels: Float32Array[], length: number) => {
    let onset = -1;
    for (let i = 0; i < length; i++) {
      let loud = false;
      for (let c = 0; c < channels.length && !loud; c++) loud = Math.abs(channels[c][i]) > threshold;
      if (!loud) {
        silent++;
        continue;
      }
      if (silent >= quiet && onset < 0) onset = i;
      silent = 0;
    }
    return onset;
  };
};
