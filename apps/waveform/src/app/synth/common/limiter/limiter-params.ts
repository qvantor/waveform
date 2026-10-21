// the ceiling of the master limiter (its Rust core, dsp/limiter: limiter-wasm.ts): no sample goes over it
export const CEILING_DB = -0.5;
export const CEILING = 10 ** (CEILING_DB / 20);
// seconds the gain sees ahead of the sound (the latency of the limiter is this and the delay of its true peak
// detector, TRUE_PEAK_DELAY samples: 32 taps per phase of the 4× interpolator, centred)
export const LOOKAHEAD = 0.002;
export const TRUE_PEAK_DELAY = 16;
