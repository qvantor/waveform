import { readFileSync } from 'node:fs';

// the Math functions jsmath ports (V8's fdlibm, glibc's pow), from tmp/wasm/jsmath-check.wasm (`npm run wasm`)
export const JSMATH_FUNCTIONS = ['sin', 'cos', 'exp', 'expm1', 'tanh', 'log', 'log2', 'log10', 'pow'];

export const loadJsMath = (path = 'tmp/wasm/jsmath-check.wasm') => {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(`${path} is missing: run \`npm run wasm\` first`);
  }
  return new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
};

// Math computes as jsmath from now on (the TS cores bundled with `**` lowered to Math.pow): the bits of Node's own
// differ by machine (its fdlibm is compiled with FMA contraction on arm64, its pow is the libm of the system)
export const installJsMath = (exports = loadJsMath()) => {
  for (const name of JSMATH_FUNCTIONS) Math[name] = exports[`js_${name}`];
  return exports;
};
