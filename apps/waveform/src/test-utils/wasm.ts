import { readFileSync } from 'fs';
import { join } from 'path';
import { CoreExports, instantiateCore } from '../app/synth/common/wasm/wasm-core';

// the wasm cores as the specs run them: the perf build of each (tmp/wasm-perf: its counters, as __PERF__ of the
// specs), built by `npm run wasm`

const DIRECTORY = join(__dirname, '../../../../tmp/wasm-perf');
const modules = new Map<string, WebAssembly.Module>();

export const wasmBytes = (name: string) => {
  const file = join(DIRECTORY, `${name}.wasm`);
  try {
    return readFileSync(file);
  } catch {
    throw new Error(`${file} is missing: run \`npm run wasm\` first`);
  }
};

// compiled once per spec file
export const wasmModule = (name: string) => {
  const cached = modules.get(name);
  if (cached) return cached;
  const module = new WebAssembly.Module(wasmBytes(name));
  modules.set(name, module);
  return module;
};

// a new instance of the core `name` (a scope of its own: its memory, its tables and voices)
export const wasmCore = <T extends CoreExports>(name: string) => instantiateCore<T>(wasmModule(name));
