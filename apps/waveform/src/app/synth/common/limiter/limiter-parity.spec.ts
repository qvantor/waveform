// first: the Math of the wasm core for the TS one (test-utils/js-math.ts)
import '../../../../test-utils/js-math';
import { Random, randomBlocks, randomSignal, RATES, pick, Signal } from '../../../../test-utils/fuzz-signals';
import { createBitsHash, createGoldens, expectSameBits, FUZZ_SCALE } from '../../../../test-utils/parity';
import { seeded } from '../../../../test-utils/seeded';
import { wasmCore } from '../../../../test-utils/wasm';
import { CEILING, createLimiterDsp } from './limiter-dsp';
import { createLimiterWasm, LimiterExports } from './limiter-wasm';

// the Rust core of the limiter (dsp/limiter) against the TS one: the bits of every output sample of every block,
// on the golden scenarios (their hashes in dsp/goldens/limiter.json) and on random ones

const core = wasmCore<LimiterExports>('limiter');
const goldens = createGoldens('limiter');
afterAll(() => goldens.save());

interface Scenario {
  rate: number;
  blocks: number[];
  input: Signal;
}

// renders both cores block by block, fails on the first sample whose bits differ; the hash of the outputs
const run = (name: string, { rate, blocks, input }: Scenario) => {
  const ts = createLimiterDsp(rate);
  const wasm = createLimiterWasm(core, rate);
  expect(wasm.latency).toBe(ts.latency);
  const hash = createBitsHash();
  let frame = 0;
  blocks.forEach((n, block) => {
    const [inL, inR] = [0, 1].map((channel) =>
      Float32Array.from({ length: n }, (_, i) => input(frame + i, channel))
    );
    const [tsL, tsR, wasmL, wasmR] = [0, 1, 2, 3].map(() => new Float32Array(n));
    ts.process(inL, inR, tsL, tsR);
    wasm.process(inL, inR, wasmL, wasmR);
    expectSameBits(name, block, 'L', tsL, wasmL);
    expectSameBits(name, block, 'R', tsR, wasmR);
    hash.add(wasmL);
    hash.add(wasmR, false);
    frame += n;
  });
  wasm.free();
  return hash.digest();
};

const quanta = (seconds: number, rate = 48000) => Array<number>(Math.ceil((seconds * rate) / 128)).fill(128);
const sine =
  (freq: number, amplitude: number, rate = 48000): Signal =>
  (n, channel) =>
    amplitude * Math.sin((2 * Math.PI * freq * n) / rate + channel);
// a dense chord of saws struck at once, about 16 dB over
const chord: Signal = (n, channel) => {
  let value = 0;
  [110, 138.6, 164.8, 220].forEach((freq) =>
    [-0.3, -0.1, 0.1, 0.3].forEach((detune) => {
      const phase = (freq * (1 + detune / 100) * n) / 48000 + (channel + detune) / 7;
      value += 2 * (phase - Math.floor(phase + 0.5));
    })
  );
  return n < 2400 ? 0 : value / 2;
};

const GOLDEN: [string, Scenario][] = [
  ['silence', { rate: 48000, blocks: quanta(0.1), input: () => 0 }],
  ['a sine below the ceiling', { rate: 48000, blocks: quanta(0.2), input: sine(440, 0.8) }],
  ['a sine 12 dB over', { rate: 48000, blocks: quanta(0.5), input: sine(1000, 4) }],
  [
    'peaks between the samples: fs/4 off its peaks',
    { rate: 48000, blocks: quanta(0.2), input: (n) => 1.2 * Math.sin((Math.PI / 2) * n + Math.PI / 4) },
  ],
  ['a dense chord struck at once', { rate: 48000, blocks: quanta(0.4), input: chord }],
  [
    'released back to exactly 1',
    {
      rate: 48000,
      blocks: quanta(3),
      input: (n) => (n < 72000 ? 4 : 0.5) * Math.sin(n / 7.64),
    },
  ],
  [
    'NaN and infinities are silence',
    {
      rate: 48000,
      blocks: quanta(0.2),
      input: (n, channel) =>
        ({ 2400: NaN, 2880: Infinity, 3360: -Infinity }[n] ?? 0.5 * Math.sin(n / 10 + channel)),
    },
  ],
  [
    '44.1 kHz, a square 12 dB over',
    { rate: 44100, blocks: quanta(0.3, 44100), input: (n) => (Math.floor(n / 50) % 2 ? 4 : -4) },
  ],
  [
    '96 kHz, blocks of 1000',
    { rate: 96000, blocks: Array<number>(30).fill(1000), input: sine(5000, 3, 96000) },
  ],
];

describe('limiter wasm core', () => {
  it.each(GOLDEN)('%s: the bits of the TS core and its golden', (name, scenario) => {
    goldens.check(name, run(name, scenario));
  });

  const randomScenario = (random: Random): Scenario => {
    const rate = pick(random, RATES);
    const frames = Math.floor(random() * 0.3 * rate);
    return { rate, blocks: randomBlocks(random, frames), input: randomSignal(random, rate, frames) };
  };

  const count = 1000 * FUZZ_SCALE;
  it(`renders ${count} random scenarios as the TS core, never NaN`, () => {
    for (let seed = 1; seed <= count; seed++) run(`seed ${seed}`, randomScenario(seeded(seed)));
  });

  it('never outputs more than the ceiling (the clamp of the TS)', () => {
    const { head } = run('loud', { rate: 48000, blocks: quanta(0.1), input: () => 1e6 });
    expect(head).toHaveLength(8);
    head.forEach((value) => expect(Math.abs(value)).toBeLessThanOrEqual(Math.fround(CEILING)));
  });
});
