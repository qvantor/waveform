import { stereoCore, StereoCoreExports } from '../wasm/stereo-core';

// the Rust core of the master limiter (dsp/limiter, limiter.wasm), with the API of createLimiterDsp
export interface LimiterExports extends StereoCoreExports {
  fx_new: (sampleRate: number) => number;
  fx_latency: (handle: number) => number;
  fx_idle: (handle: number) => number;
}

export const createLimiterWasm = (exports: LimiterExports, sampleRate: number) => {
  const handle = exports.fx_new(sampleRate);
  return {
    ...stereoCore(exports, handle),
    latency: exports.fx_latency(handle),
    // it has let go and its input has been +0 long enough: the next block of +0 is skipped (the specs)
    get idle() {
      return exports.fx_idle(handle) !== 0;
    },
  };
};
