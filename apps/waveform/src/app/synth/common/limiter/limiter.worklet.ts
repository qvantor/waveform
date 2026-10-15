import { registerStereoProcessor } from '../../fx/effects/stereo-processor';
import { createLimiterDsp, LIMITER_PROCESSOR } from './limiter-dsp';

// the audio worklet module of the master limiter, bundled by esbuild (`npm run worklets`) into
// assets/worklets/limiter.js; it runs in the AudioWorkletGlobalScope: no window, document or React

registerStereoProcessor(LIMITER_PROCESSOR, (rate) => createLimiterDsp(rate));
