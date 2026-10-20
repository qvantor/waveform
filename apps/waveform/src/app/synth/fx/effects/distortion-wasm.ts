import { stereoCore, StereoCoreExports } from '../../common/wasm/stereo-core';
import { createView } from '../../common/wasm/wasm-core';
import type { DistortionDspParams, DistortionOptions } from './distortion-dsp';

// the Rust core of the distortion (dsp/distortion, distortion.wasm), with the API of createDistortionDsp

// the params in the order of the core (dsp/distortion/src/lib.rs)
export const DISTORTION_KEYS: readonly (keyof DistortionDspParams)[] = ['mode', 'drive', 'tone', 'level'];

export interface DistortionExports extends StereoCoreExports {
  // the buffer of the params of fx_new and fx_set: the bits of the keys fx_set changes, then the params
  fx_command: () => number;
  fx_new: (sampleRate: number) => number;
  fx_set: (handle: number) => void;
  fx_idle: (handle: number) => number;
}

export const createDistortionWasm = (
  exports: DistortionExports,
  sampleRate: number,
  { params }: DistortionOptions
) => {
  const view = createView(exports, Float64Array);
  const command = () => view(exports.fx_command(), DISTORTION_KEYS.length + 1);
  const options = command();
  DISTORTION_KEYS.forEach((key, i) => (options[1 + i] = params[key]));
  const handle = exports.fx_new(sampleRate);
  return {
    ...stereoCore(exports, handle),
    set: (changes: Partial<DistortionDspParams>) => {
      const buffer = command();
      let present = 0;
      for (let i = 0; i < DISTORTION_KEYS.length; i++) {
        const value = changes[DISTORTION_KEYS[i]];
        if (value === undefined) continue;
        present |= 1 << i;
        buffer[1 + i] = value;
      }
      buffer[0] = present;
      exports.fx_set(handle);
    },
    get idle() {
      return exports.fx_idle(handle) !== 0;
    },
  };
};
