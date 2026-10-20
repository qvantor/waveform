// the core a worklet module runs: its Rust one (dsp/, the bundle <name>.wasm.js) or its TS one (<name>.js), as
// long as both exist. `?dsp=js` in the url or localStorage.dsp = 'js' loads the TS ones (a rollback without a
// build), 'wasm' the wasm ones of every module; by default a module runs its wasm core once that has passed its
// gate (WASM_DEFAULT)

export type DspMode = 'js' | 'wasm';

// the modules with a wasm core, and those that load it by default
export const WASM_MODULES: readonly string[] = ['limiter', 'reverb', 'distortion', 'wavetable-osc'];
export const WASM_DEFAULT: readonly string[] = ['limiter', 'reverb', 'distortion', 'wavetable-osc'];

// the mode asked for in the url or the storage, null: the default
export const dspMode = (): DspMode | null => {
  try {
    const value =
      new URLSearchParams(window.location.search).get('dsp') ?? window.localStorage.getItem('dsp');
    return value === 'js' || value === 'wasm' ? value : null;
  } catch {
    // a storage that throws (blocked site data)
    return null;
  }
};

export const isWasmModule = (name: string) => {
  if (!WASM_MODULES.includes(name)) return false;
  const mode = dspMode();
  return mode ? mode === 'wasm' : WASM_DEFAULT.includes(name);
};

// the bundle of the worklet module `name` (assets/worklets/<bundle>.js)
export const workletBundle = (name: string) => (isWasmModule(name) ? `${name}.wasm` : name);

// a module of one SIMD instruction (i8x16.splat, i8x16.popcnt): the cores are built with wasm SIMD (Safari 16.4+)
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
