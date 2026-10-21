import { CoreExports } from '../app/synth/common/wasm/wasm-core';
import { wasmExports } from './wasm';

// Math as the wasm cores compute it: jsmath (dsp/jsmath, V8's fdlibm and glibc's pow, from
// tmp/wasm-perf/jsmath-check.wasm). Import it first in a spec that compares a TS core with its wasm one bit for bit,
// before the TS modules work out their tables (the specs run `**` as Math.pow, jest.config.ts). The Math of Node
// differs by machine (on arm64 its fdlibm is compiled with FMA contraction, its pow is the libm of the system):
// under jsmath both cores compute every value alike, the bits differ only where the port does

export const JSMATH_FUNCTIONS = [
  'sin',
  'cos',
  'exp',
  'expm1',
  'tanh',
  'log',
  'log2',
  'log10',
  'pow',
] as const;

type JsMathExports = CoreExports & Record<string, (...args: number[]) => number>;

export const jsmath = wasmExports<JsMathExports>('jsmath-check');
// Node's own, to compare jsmath with
export const nodeMath = Object.fromEntries(JSMATH_FUNCTIONS.map((name) => [name, Math[name]])) as Pick<
  Math,
  typeof JSMATH_FUNCTIONS[number]
>;

JSMATH_FUNCTIONS.forEach((name) => {
  Object.assign(Math, { [name]: jsmath[`js_${name}`] });
});
