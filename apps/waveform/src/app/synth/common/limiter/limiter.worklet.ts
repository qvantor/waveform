import bytes from '@waveform/wasm/limiter.wasm';
import { registerStereoProcessor } from '../../fx/effects/stereo-processor';
import { LIMITER_PROCESSOR } from '../processors';
import { prewarmStereo } from '../wasm/stereo-core';
import { instantiateCore } from '../wasm/wasm-core';
import { createLimiterWasm, LimiterExports } from './limiter-wasm';

// the audio worklet module of the master limiter with its Rust core (dsp/limiter), bundled by esbuild
// (`npm run worklets`) into assets/worklets/limiter.js with the bytes of limiter.wasm; it runs in the
// AudioWorkletGlobalScope: no window, document or React

declare const sampleRate: number;

const core = instantiateCore<LimiterExports>(new WebAssembly.Module(bytes));
prewarmStereo(createLimiterWasm(core, sampleRate));

registerStereoProcessor(LIMITER_PROCESSOR, (rate) => createLimiterWasm(core, rate));
