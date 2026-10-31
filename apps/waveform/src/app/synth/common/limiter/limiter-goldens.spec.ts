// first: the Math of JS as jsmath (test-utils/js-math.ts): the inputs and the levels the TS builds the same on every
// machine (Node's own Math differs in the last bits on arm64), so are the goldens
import '../../../../test-utils/js-math';
import { Random, randomBlocks, randomSignal, RATES, pick, Signal } from '../../../../test-utils/fuzz-signals';
import { createGoldens, FUZZ_SCALE, runStereo } from '../../../../test-utils/parity';
import { seeded } from '../../../../test-utils/seeded';
import { wasmCore } from '../../../../test-utils/wasm';
import { CEILING, LOOKAHEAD, TRUE_PEAK_DELAY } from './limiter-params';
import { createLimiterWasm, LimiterExports } from './limiter-wasm';

// the Rust core of the limiter (dsp/limiter): the bits of every output sample of every block on the golden
// scenarios (their hashes in dsp/goldens/limiter.json), and random ones: finite, never over the ceiling

const core = wasmCore<LimiterExports>('limiter');
const goldens = createGoldens('limiter');
afterAll(() => goldens.save());

interface Scenario {
  rate: number;
  blocks: number[];
  input: Signal;
}

// the largest sample a Float32Array output can hold at the ceiling
const MAX_SAMPLE = Math.fround(CEILING);

// renders the core block by block: finite, never over the ceiling; the hash of the outputs
const run = (name: string, { rate, blocks, input }: Scenario) => {
  const limiter = createLimiterWasm(core, rate);
  expect(limiter.latency).toBe(Math.round(LOOKAHEAD * rate) + TRUE_PEAK_DELAY);
  const over = (data: Float32Array) => data.some((value) => Math.abs(value) > MAX_SAMPLE);
  return runStereo(name, {
    core: limiter,
    blocks,
    input,
    check: (outL, outR, block) => {
      if (over(outL) || over(outR)) throw new Error(`${name}: block ${block} goes over the ceiling`);
    },
  });
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

// a signal of parts one after another: [seconds, signal] each, silence after the last one
const parts = (rate: number, list: [number, Signal][]): Signal => {
  let from = 0;
  const spans = list.map(([seconds, signal]) => {
    const span = { from, to: from + Math.round(seconds * rate), signal };
    from = span.to;
    return span;
  });
  return (n, channel) => {
    const span = spans.find(({ to }) => n < to);
    return span ? span.signal(n - span.from, channel) : 0;
  };
};
const silence: Signal = () => 0;
// notes under the ceiling and over it with silences of every length between them: the limiter goes idle once it
// has let go (a −0 holds it, a NaN wakes it as a sound would), the next note wakes it
const notesAndSilences = parts(48000, [
  [0.1, sine(440, 0.6)],
  [0.1, silence],
  [0.05, sine(440, 0.6)],
  [0.1, (n) => (n < 2400 ? -0 : 0)],
  [0.2, sine(1000, 4)],
  [0.005, silence],
  [0.1, sine(330, 0.6)],
  [0.03, silence],
  [0.1, sine(330, 0.6)],
  [1.5, (n) => (n === 48000 ? NaN : 0)],
  [0.2, chord],
  [0.4, silence],
]);
// blocks of 1 to 1000
const oddBlocks = (frames: number) => {
  const sizes = [1, 7, 128, 333, 1000, 64, 999, 2];
  const blocks: number[] = [];
  for (let at = 0, i = 0; at < frames; at += blocks[blocks.length - 1], i++)
    blocks.push(sizes[i % sizes.length]);
  return blocks;
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
  ['notes and silences: idle and woken', { rate: 48000, blocks: quanta(2.9), input: notesAndSilences }],
  [
    '44.1 kHz, blocks of 1 to 1000: released into a silence, struck again',
    {
      rate: 44100,
      blocks: oddBlocks(2.6 * 44100),
      input: parts(44100, [
        [0.3, (n) => (Math.floor(n / 50) % 2 ? 4 : -4)],
        [1.5, silence],
        [0.2, sine(220, 0.5, 44100)],
        [0.03, silence],
        [0.2, sine(220, 2, 44100)],
      ]),
    },
  ],
];

describe('limiter wasm core', () => {
  it.each(GOLDEN)('%s: its golden', (name, scenario) => {
    goldens.check(name, run(name, scenario));
  });

  const randomScenario = (random: Random): Scenario => {
    const rate = pick(random, RATES);
    const frames = Math.floor(random() * 0.3 * rate);
    return { rate, blocks: randomBlocks(random, frames), input: randomSignal(random, rate, frames) };
  };

  const count = 1000 * FUZZ_SCALE;
  it(`renders ${count} random scenarios, finite and under the ceiling`, () => {
    for (let seed = 1; seed <= count; seed++) run(`seed ${seed}`, randomScenario(seeded(seed)));
  });

  it('never outputs more than the ceiling (its clamp)', () => {
    const { head } = run('loud', { rate: 48000, blocks: quanta(0.1), input: () => 1e6 });
    expect(head).toHaveLength(8);
    head.forEach((value) => expect(Math.abs(value)).toBeLessThanOrEqual(MAX_SAMPLE));
  });
});
