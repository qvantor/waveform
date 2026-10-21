import bytes from '@waveform/wasm/reverb.wasm';
import { REVERB_PROCESSOR } from '../../common/processors';
import { prewarmStereo } from '../../common/wasm/stereo-core';
import { instantiateCore } from '../../common/wasm/wasm-core';
import type { ReverbMessage, ReverbOptions } from './reverb-params';
import { createReverbWasm, ReverbExports } from './reverb-wasm';
import { registerStereoProcessor } from './stereo-processor';

// the audio worklet module of the reverb with its Rust core (dsp/reverb), bundled by esbuild (`npm run
// worklets`) into assets/worklets/reverb.js with the bytes of reverb.wasm; it runs in the
// AudioWorkletGlobalScope: no window, document or React

declare const sampleRate: number;

const core = instantiateCore<ReverbExports>(new WebAssembly.Module(bytes));
prewarmStereo(
  createReverbWasm(core, sampleRate, {
    params: {
      lowcut: 20,
      pre: 0.02,
      size: 0.5,
      decay: 2,
      damp: 6000,
      bass: 1,
      depth: 0.2,
      sep: 1,
      er: 0.5,
      drive: 0.15,
      bandwidth: 6500,
      body: 2,
    },
    active: true,
  })
);

registerStereoProcessor(
  REVERB_PROCESSOR,
  (rate, { processorOptions }) => createReverbWasm(core, rate, processorOptions as ReverbOptions),
  (dsp, { params, active }: ReverbMessage) => {
    if (params) dsp.set(params);
    if (active !== undefined) dsp.setActive(active);
  },
  // the knobs the envelopes move (fx-modulation.ts); the lines are worked out again only while they move
  (dsp, values) => dsp.set(values, true)
);
