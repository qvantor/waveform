// the params, the options and the messages of the reverb (its Rust core, dsp/reverb: reverb-wasm.ts), no signal
// processing here

// the reverb params (FX_PARAMS.reverb) with the era resolved to the values of its input stage
export interface ReverbDspParams {
  lowcut: number;
  pre: number;
  size: number;
  decay: number;
  damp: number;
  bass: number;
  depth: number;
  sep: number;
  er: number;
  // the era: tube drive, input lowpass (Hz, nyquist: the full band) and body boost (dB)
  drive: number;
  bandwidth: number;
  body: number;
}

export interface ReverbOptions {
  params: ReverbDspParams;
  active: boolean;
}

// main thread → worklet: changed params, the active flag
export interface ReverbMessage {
  params?: Partial<ReverbDspParams>;
  active?: boolean;
}

// the ranges the buffers of the core are allocated for (FX_PARAMS.reverb, not imported: it would bundle zod)
export const MAX_PREDELAY = 0.3;
export const MAX_SIZE = 1;
