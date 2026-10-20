import bytes from '@waveform/wasm/distortion.wasm';
import { DISTORTION_PROCESSOR } from '../../common/processors';
import { prewarmStereo } from '../../common/wasm/stereo-core';
import { instantiateCore } from '../../common/wasm/wasm-core';
import type { DistortionMessage, DistortionOptions } from './distortion-params';
import { createDistortionWasm, DistortionExports } from './distortion-wasm';
import { registerStereoProcessor } from './stereo-processor';

// the audio worklet module of the distortion with its Rust core (dsp/distortion), bundled by esbuild (`npm run
// worklets`) into assets/worklets/distortion.js with the bytes of distortion.wasm; it runs in the
// AudioWorkletGlobalScope: no window, document or React

declare const sampleRate: number;

const core = instantiateCore<DistortionExports>(new WebAssembly.Module(bytes));
// (both curves: the mode changes in the second block)
const warm = createDistortionWasm(core, sampleRate, { params: { mode: 0, drive: 6, tone: 5000, level: 0 } });
prewarmStereo({
  process: (inL, inR, outL, outR) => {
    warm.process(inL, inR, outL, outR);
    warm.set({ mode: 1 });
  },
  free: warm.free,
});

registerStereoProcessor(
  DISTORTION_PROCESSOR,
  (rate, { processorOptions }) => createDistortionWasm(core, rate, processorOptions as DistortionOptions),
  (dsp, { params }: DistortionMessage) => {
    if (params) dsp.set(params);
  },
  // the knobs the envelopes move (fx-modulation.ts)
  (dsp, values) => dsp.set(values)
);
