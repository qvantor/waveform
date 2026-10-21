import { createHash } from 'crypto';
import { jsmath, JSMATH_FUNCTIONS, nodeMath } from '../../../../test-utils/js-math';
import { FUZZ_SCALE } from '../../../../test-utils/parity';
import { seeded } from '../../../../test-utils/seeded';

// jsmath (dsp/jsmath): the Math of the wasm cores. Its fdlibm is V8's (deps/v8/src/base/ieee754.cc) compiled
// without FMA contraction, as Node runs it on x64 (and Chrome everywhere, built with -ffp-contract=off); its pow is
// glibc's without FMA. Node on arm64 compiles the same fdlibm with FMA contraction (the last bit differs in up
// to 0.4% of the inputs, by up to 3 ulps for tanh) and calls the libm of the system for pow: there jsmath is
// checked within CONTRACTED ulps (pow within 1), and
// everywhere against the hash of its outputs (the last spec: a change of jsmath changes the sound of every core)

const UNARY = JSMATH_FUNCTIONS.filter((name) => name !== 'pow');
const EXACT = process.arch === 'x64';
// the most ulps the FMA-contracted fdlibm of Node on arm64 differs by
const CONTRACTED = 4;
const COUNT = 200000 * FUZZ_SCALE;

const words = new Float64Array(1);
const halves = new Uint32Array(words.buffer);
const fromBits = (high: number, low: number) => {
  halves[1] = high >>> 0;
  halves[0] = low >>> 0;
  return words[0];
};

// random bit patterns, the working ranges of the cores and around the branches of fdlibm
const inputs = (random: () => number, count: number) =>
  Float64Array.from({ length: count }, (_, i) => {
    switch (i % 4) {
      case 0:
        return fromBits(random() * 2 ** 32, random() * 2 ** 32);
      case 1:
        return (random() - 0.5) * 40;
      case 2:
        return (random() - 0.5) * 2 ** (random() * 60 - 30);
      default:
        return (random() - 0.5) * 2 * Math.PI * (1 + Math.floor(random() * 8));
    }
  });

const SPECIAL = [
  0,
  -0,
  Infinity,
  -Infinity,
  NaN,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  2.2250738585072014e-308,
  1e-300,
  Number.MAX_VALUE,
  1,
  -1,
  0.5,
  Math.PI / 4,
  Math.PI / 2,
  Math.PI,
  (3 * Math.PI) / 4,
  2 ** 19 * (Math.PI / 2),
  1e22,
  709.782712893384,
  -745.1332191019411,
  22,
  2 ** -28,
  2 ** -54,
  Math.SQRT2,
  Math.SQRT1_2,
];

const same = (a: number, b: number) => Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));

// the distance in units of the last place (of two finite values of one sign: their bits are ordered as they are)
const ulps = (a: number, b: number) => {
  if (same(a, b)) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.sign(a) !== Math.sign(b)) return Infinity;
  words[0] = a;
  const [lowA, highA] = [halves[0], halves[1]];
  words[0] = b;
  return Math.abs((highA - halves[1]) * 4294967296 + (lowA - halves[0]));
};

const call = (name: string, ...args: number[]) => jsmath[`js_${name}`](...args);
const node = (name: typeof UNARY[number], x: number) => (nodeMath[name] as (x: number) => number)(x);

describe('jsmath', () => {
  it.each(UNARY)('%s matches the Math of Node on the special values', (name) => {
    SPECIAL.forEach((x) => {
      const expected = node(name, x);
      const value = call(name, x);
      if (EXACT || !Number.isFinite(expected) || expected === 0) expect([x, value]).toEqual([x, expected]);
      else expect(ulps(value, expected)).toBeLessThanOrEqual(CONTRACTED);
    });
  });

  it.each(UNARY)(
    `%s matches the Math of Node on ${COUNT} inputs (${EXACT ? 'bit for bit' : `within ${CONTRACTED} ulps`})`,
    (name) => {
      const values = inputs(seeded(name.length * 7919), COUNT);
      let worst = 0;
      let first: number | null = null;
      values.forEach((x) => {
        const distance = ulps(call(name, x), node(name, x));
        if (distance > worst) worst = distance;
        if (distance > 0 && first === null) first = x;
      });
      if (EXACT) expect({ first, worst }).toEqual({ first: null, worst: 0 });
      else expect(worst).toBeLessThanOrEqual(CONTRACTED);
    }
  );

  it(`pow matches the Math of Node within 1 ulp (the libm of the system) on ${COUNT} inputs`, () => {
    const random = seeded(31337);
    for (let i = 0; i < COUNT; i++) {
      const [x, y] =
        i % 3 === 0
          ? [10, (random() - 0.5) * 20]
          : i % 3 === 1
          ? [2, (random() - 0.5) * 40]
          : [random() * 100, (random() - 0.5) * 20];
      expect(ulps(call('pow', x, y), x ** y)).toBeLessThanOrEqual(1);
    }
  });

  it('pow has the special cases of ECMAScript and of V8 bit for bit', () => {
    const values = [0, -0, 1, -1, 2, -2, 0.5, -0.5, 3, -3, 10, Infinity, -Infinity, NaN, 1e-310, 1e300];
    values.forEach((x) =>
      values.forEach((y) => {
        const expected = x ** y;
        if (
          Number.isInteger(expected) ||
          !Number.isFinite(expected) ||
          expected === 0 ||
          y === 2 ||
          y === 0.5
        )
          expect([x, y, call('pow', x, y)]).toEqual([x, y, expected]);
      })
    );
    // integers are exact
    for (let k = -40; k <= 40; k++) expect(call('pow', 2, k)).toBe(2 ** k);
  });

  it('the JS semantics of round, max and min', () => {
    [0.5, -0.5, 1.5, -1.5, 2.5, 0.49999999999999994, -0.4, -0, NaN, Infinity, 4503599627370495.5].forEach(
      (x) => expect(call('round', x)).toEqual(Math.round(x))
    );
    [
      [0, -0],
      [-0, 0],
      [-0, -0],
      [NaN, 1],
      [1, NaN],
      [1, 2],
    ].forEach(([a, b]) => {
      expect(call('max', a, b)).toEqual(Math.max(a, b));
      expect(call('min', a, b)).toEqual(Math.min(a, b));
    });
    expect(call('to_int32', 1e20)).toBe(1e20 | 0);
    expect(call('to_int32', -2147483649)).toBe(-2147483649 | 0);
  });

  it('computes the same bits on every machine (the hashes of its outputs)', () => {
    const hash = createHash('sha256');
    const values = inputs(seeded(4242), 100000);
    const out = new Float64Array(values.length);
    JSMATH_FUNCTIONS.forEach((name) => {
      values.forEach((x, i) => {
        out[i] = name === 'pow' ? call('pow', Math.abs(x) % 50, x % 10) : call(name, x);
      });
      hash.update(new Uint8Array(out.buffer));
    });
    expect(hash.digest('hex')).toBe('fb3576672374e5fe9737d7b951b37642eda6eeed9eab4e2cc050b5f0ffe7923f');
  });
});
