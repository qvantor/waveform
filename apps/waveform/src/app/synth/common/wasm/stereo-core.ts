import { CoreExports, createView } from './wasm-core';

// the C ABI of the stereo cores (dsp/limiter, dsp/reverb, dsp/distortion): fx_buffers reserves a block of
// `frames` (inL, inR, outL, outR one after another), fx_process renders it
export interface StereoCoreExports extends CoreExports {
  fx_buffers: (handle: number, frames: number) => number;
  fx_process: (handle: number) => void;
  fx_free: (handle: number) => void;
}

// copies `source` into the block, a shorter one padded with NaN (the TS cores read undefined there)
const copyIn = (target: Float32Array, source: Float32Array) => {
  if (source.length === target.length) target.set(source);
  else {
    target.set(source.subarray(0, target.length));
    target.fill(NaN, Math.min(source.length, target.length));
  }
};

// process() of the StereoDsp of a core (stereo-processor.ts): the inputs into its memory, the block rendered, the
// outputs out of it; free() frees its handle (the processor is stopped)
export const stereoCore = (exports: StereoCoreExports, handle: number) => {
  // a view per channel: no array is created per block
  const [viewInL, viewInR, viewOutL, viewOutR] = [0, 1, 2, 3].map(() => createView(exports));
  let freed = false;
  return {
    process: (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array) => {
      const frames = outL.length;
      const bytes = 4 * frames;
      // (guarded here, not by instantiateCore: no closure per block; fx_buffers grows the block)
      const stack = exports.__stack_pointer.value;
      let at: number;
      try {
        at = exports.fx_buffers(handle, frames);
        copyIn(viewInL(at, frames), inL);
        copyIn(viewInR(at + bytes, frames), inR);
        exports.fx_process(handle);
      } catch (error) {
        exports.__stack_pointer.value = stack;
        throw error;
      }
      // (a view is made again if the memory grew)
      outL.set(viewOutL(at + 2 * bytes, frames));
      outR.set(viewOutR(at + 3 * bytes, frames));
    },
    free: () => {
      if (freed) return;
      freed = true;
      exports.fx_free(handle);
    },
  };
};

// the functions of a block compile lazily, on their first call: a dsp made while the module loads renders a few
// blocks of an impulse (a silent input would leave an effect idle; over the ceiling of the limiter) and is freed,
// so the first processor doesn't compile them in its constructor and its first block (the limiter 0.5 ms, the
// reverb 0.9 in Node, the module 0.5 and 1.1 ms longer)
export const prewarmStereo = (dsp: { process: StereoProcess; free: () => void }, blocks = 3) => {
  const input = new Float32Array(128);
  const [outL, outR] = [new Float32Array(128), new Float32Array(128)];
  input[0] = 1.5;
  for (let i = 0; i < blocks; i++) dsp.process(input, input, outL, outR);
  dsp.free();
};

type StereoProcess = (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array) => void;
