// the worklet modules with a Rust core (dsp/): they need wasm SIMD (the cores are built with it), Safari 16.4+;
// without it a module is unsupported (the limiter stays on its compressor, the oscillators show why)
export const WASM_MODULES: readonly string[] = ['limiter', 'reverb', 'distortion', 'wavetable-osc'];

// a module of one SIMD instruction (i8x16.splat, i8x16.popcnt)
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98,
  11,
]);

export const isWasmSimdSupported = () => {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
};
