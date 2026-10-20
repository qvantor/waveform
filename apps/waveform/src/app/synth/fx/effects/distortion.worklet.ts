import {
  createDistortionDsp,
  DISTORTION_PROCESSOR,
  DistortionMessage,
  DistortionOptions,
} from './distortion-dsp';
import { registerStereoProcessor } from './stereo-processor';

// the audio worklet module of the distortion, bundled by esbuild (`npm run worklets`) into
// assets/worklets/distortion.js; it runs in the AudioWorkletGlobalScope: no window, document or React

registerStereoProcessor(
  DISTORTION_PROCESSOR,
  (rate, { processorOptions }) => createDistortionDsp(rate, processorOptions as DistortionOptions),
  (dsp, { params }: DistortionMessage) => {
    if (params) dsp.set(params);
  },
  // the knobs the envelopes move (fx-modulation.ts)
  (dsp, values) => dsp.set(values)
);
