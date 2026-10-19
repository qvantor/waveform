import { createReverbDsp, REVERB_PROCESSOR, ReverbMessage, ReverbOptions } from './reverb-dsp';
import { registerStereoProcessor } from './stereo-processor';

// the audio worklet module of the reverb, bundled by esbuild (`npm run worklets`) into
// assets/worklets/reverb.js; it runs in the AudioWorkletGlobalScope: no window, document or React

registerStereoProcessor(
  REVERB_PROCESSOR,
  (rate, { processorOptions }) => createReverbDsp(rate, processorOptions as ReverbOptions),
  (dsp, { params, active }: ReverbMessage) => {
    if (params) dsp.set(params);
    if (active !== undefined) dsp.setActive(active);
  },
  // the knobs the envelopes move (fx-modulation.ts); the lines are worked out again only while they move
  (dsp, values) => dsp.set(values, true)
);
