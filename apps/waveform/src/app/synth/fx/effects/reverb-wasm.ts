import { stereoCore, StereoCoreExports } from '../../common/wasm/stereo-core';
import { createView } from '../../common/wasm/wasm-core';
import type { ReverbDspParams, ReverbOptions } from './reverb-dsp';

// the Rust core of the reverb (dsp/reverb, reverb.wasm), with the API of createReverbDsp

// the params in the order of the core (dsp/reverb/src/lib.rs)
export const REVERB_KEYS: readonly (keyof ReverbDspParams)[] = [
  'lowcut',
  'pre',
  'size',
  'decay',
  'damp',
  'bass',
  'depth',
  'sep',
  'er',
  'drive',
  'bandwidth',
  'body',
];

export interface ReverbExports extends StereoCoreExports {
  // the buffer the options of fx_new (active, the params) and the changes of fx_set (count, key, value…) go into
  fx_command: () => number;
  fx_new: (sampleRate: number) => number;
  fx_set: (handle: number, routed: boolean) => void;
  fx_set_active: (handle: number, active: boolean) => void;
  fx_idle: (handle: number) => number;
}

export const createReverbWasm = (
  exports: ReverbExports,
  sampleRate: number,
  { params, active }: ReverbOptions
) => {
  const view = createView(exports, Float64Array);
  const command = () => view(exports.fx_command(), 2 * REVERB_KEYS.length + 2);
  const options = command();
  options[0] = active ? 1 : 0;
  REVERB_KEYS.forEach((key, i) => (options[1 + i] = params[key]));
  const handle = exports.fx_new(sampleRate);
  return {
    ...stereoCore(exports, handle),
    // the known keys with a value, in the order of the message (for…in: no array per block)
    set: (changes: Partial<ReverbDspParams>, routed = false) => {
      const buffer = command();
      let count = 0;
      for (const key in changes) {
        const index = REVERB_KEYS.indexOf(key as keyof ReverbDspParams);
        const value = changes[key as keyof ReverbDspParams];
        if (index < 0 || value === undefined) continue;
        buffer[1 + 2 * count] = index;
        buffer[2 + 2 * count] = value;
        count++;
      }
      buffer[0] = count;
      exports.fx_set(handle, routed);
    },
    setActive: (value: boolean) => exports.fx_set_active(handle, value),
    get idle() {
      return exports.fx_idle(handle) !== 0;
    },
  };
};
