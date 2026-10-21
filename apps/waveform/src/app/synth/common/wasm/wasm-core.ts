// the wasm cores of the worklet modules (dsp/: Rust → wasm32, `npm run wasm`): one .wasm per worklet bundle, its
// bytes in the bundle (esbuild's binary loader), compiled synchronously when the module runs in the
// AudioWorkletGlobalScope (it has no fetch). One instance per module and scope, every processor is a handle into
// its memory. No SharedArrayBuffer and no wasm-bindgen: the C ABI of the exports, numbers in and out, blocks in
// the memory of the core. A worklet module must not import the TS core it replaces (it would bundle it)

export interface CoreExports {
  memory: WebAssembly.Memory;
  // a trap (a panic: abort) leaves the stack pointer where the trapping call had moved it
  __stack_pointer: WebAssembly.Global;
}

// the calls of a block, guarded where they are called (no closure per block: stereo-core.ts,
// wavetable-osc-wasm.ts), and a getter read every block (it reads a field: it can't trap)
const UNGUARDED = new Set([
  'fx_process',
  'fx_buffers',
  'osc_voice_process',
  'osc_io',
  'osc_voice_started_at',
]);

// every other function of the core puts the stack pointer back when it traps: a trap (an allocation that failed,
// an index out of its bounds) leaves it where the call had moved it, about 70 failed note ons (the frame of
// osc_voice_new) would use up the stack of 64 KiB and every call of the core would trap until a reload. A call
// that returns has put it back itself
const guardExports = <T extends CoreExports>(exports: WebAssembly.Exports) => {
  const { __stack_pointer: stack } = exports as unknown as CoreExports;
  const guarded = Object.fromEntries(
    Object.entries(exports).map(([name, value]) => {
      if (typeof value !== 'function' || UNGUARDED.has(name)) return [name, value];
      const call = value as (...args: unknown[]) => unknown;
      return [
        name,
        (...args: unknown[]) => {
          const at = stack.value;
          try {
            return call(...args);
          } catch (error) {
            stack.value = at;
            throw error;
          }
        },
      ];
    })
  );
  return guarded as unknown as T;
};

// the instance of a module (the specs make one per scope), its calls guarded; no imports: the cores call nothing
// outside
export const instantiateCore = <T extends CoreExports>(module: WebAssembly.Module) =>
  guardExports<T>(new WebAssembly.Instance(module, {}).exports);

type ViewType = Float32ArrayConstructor | Float64ArrayConstructor | Int32ArrayConstructor;

// a typed array (a Float32Array by default) on the memory of a core, made again when the block moved or the
// memory has grown: memory.grow detaches the old buffer, a view on it has the length 0 (the getter of
// memory.buffer is not called per block). No array is created per block. A pointer comes as an i32: above 2 GiB
// it is negative, read unsigned
export const createView = <T extends ViewType = Float32ArrayConstructor>(
  exports: CoreExports,
  type: T = Float32Array as T
) => {
  let view = new type(0) as InstanceType<T>;
  let at = -1;
  return (pointer: number, length: number) => {
    if (view.length !== length || pointer !== at) {
      at = pointer;
      view = new type(exports.memory.buffer, pointer >>> 0, length) as InstanceType<T>;
    }
    return view;
  };
};
