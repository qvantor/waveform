// first: the Math of JS as jsmath (test-utils/js-math.ts): the inputs and the levels the TS builds the same on every
// machine (Node's own Math differs in the last bits on arm64), so are the goldens
import '../../../../test-utils/js-math';
import { FX_PARAMS } from '@waveform/preset-schema';
import {
  pick,
  Random,
  randomBlocks,
  randomSignal,
  RATES,
  Signal,
  withSpecials,
} from '../../../../test-utils/fuzz-signals';
import { createGoldens, expectFinite, FUZZ_SCALE, runStereo } from '../../../../test-utils/parity';
import { seeded } from '../../../../test-utils/seeded';
import { wasmCore } from '../../../../test-utils/wasm';
import { DistortionDspParams, TONE_OPEN } from './distortion-params';
import { DISTORTION_MODES } from './distortion-modes';
import { createDistortionWasm, DISTORTION_KEYS, DistortionExports } from './distortion-wasm';

// the Rust core of the distortion (dsp/distortion): the bits of every output sample of every block on the golden
// scenarios (their hashes in dsp/goldens/distortion.json), and random ones: finite

const core = wasmCore<DistortionExports>('distortion');
const goldens = createGoldens('distortion');
afterAll(() => goldens.save());

type Distortion = ReturnType<typeof createDistortionWasm>;
interface Scenario {
  rate: number;
  params: DistortionDspParams;
  blocks: number[];
  input: Signal;
  // the params set before a block (a message or the knobs the envelopes move)
  changes?: Record<number, Partial<DistortionDspParams>[]>;
}

const run = (name: string, { rate, params, blocks, input, changes = {} }: Scenario) =>
  runStereo<Distortion>(name, {
    core: createDistortionWasm(core, rate, { params }),
    blocks,
    input,
    before: (dsp, block) => changes[block]?.forEach((change) => dsp.set(change)),
  });

const RATE = 48000;
const quanta = (seconds: number, rate = RATE) => Array<number>(Math.ceil((seconds * rate) / 128)).fill(128);
// a saw of a few partials and a narrow pulse (an asymmetric wave: DC from the curve)
const tone: Signal = (n, channel) =>
  0.5 * Math.sin(n / 7 + channel) + 0.3 * Math.sin(n / 3.5) + 0.1 * Math.sin(n / 1.2);
const pulse: Signal = (n) => (n % 109 < 8 ? 0.8 : -0.06);
const blockOf = (seconds: number) => Math.floor((seconds * RATE) / 128);
const BASE: DistortionDspParams = { mode: 0, drive: 8, tone: TONE_OPEN, level: 0 };

const GOLDEN: [string, Scenario][] = [
  ...DISTORTION_MODES.flatMap((mode, index) =>
    [0, 6, 12].map((drive): [string, Scenario] => [
      `${mode.id}, drive ${drive} dB`,
      { rate: RATE, params: { ...BASE, mode: index, drive }, blocks: quanta(0.1), input: tone },
    ])
  ),
  [
    'the tone closed, an asymmetric wave',
    { rate: RATE, params: { ...BASE, tone: 800 }, blocks: quanta(0.3), input: pulse },
  ],
  [
    'the tone glides through its open top and back',
    {
      rate: RATE,
      params: { ...BASE, tone: 5000 },
      blocks: quanta(0.3),
      input: tone,
      changes: { [blockOf(0.05)]: [{ tone: TONE_OPEN }], [blockOf(0.15)]: [{ tone: 3000 }] },
    },
  ],
  [
    'a new mode during a fade, and back to the old one',
    {
      rate: RATE,
      params: BASE,
      blocks: quanta(0.2),
      input: tone,
      changes: {
        [blockOf(0.05)]: [{ mode: 1 }],
        [blockOf(0.05) + 1]: [{ mode: 0 }],
        [blockOf(0.1)]: [{ mode: 1 }],
      },
    },
  ],
  [
    'idle, sound, idle again',
    {
      rate: RATE,
      params: { ...BASE, drive: 12 },
      blocks: quanta(1.6),
      input: (n, channel) => (n > 4800 && n < 14400 ? pulse(n, channel) : 0),
    },
  ],
  [
    'drive and level moved by an envelope every block',
    {
      rate: RATE,
      params: BASE,
      blocks: quanta(0.3),
      input: tone,
      changes: Object.fromEntries(
        quanta(0.3).map((_, block) => [
          block,
          [{ drive: 6 + 6 * Math.sin(block / 7), level: -3 * Math.cos(block / 5) }],
        ])
      ),
    },
  ],
  [
    '96 kHz, blocks of 1000',
    {
      rate: 96000,
      params: { ...BASE, mode: 1, tone: 9000 },
      blocks: Array<number>(20).fill(1000),
      input: tone,
    },
  ],
];

// a value of a param in its range, sometimes its top beyond it (the makeup clamps the drive, the tone takes any)
const valueOf = (random: Random, key: keyof DistortionDspParams) => {
  const { min, max } = FX_PARAMS.distortion[key];
  if (key === 'mode') return Math.floor(random() * (max + 1));
  return min + random() * (max - min) * (random() < 0.1 ? 1.3 : 1);
};

const randomScenario = (random: Random): Scenario => {
  const rate = pick(random, RATES);
  const frames = Math.floor(random() * 0.3 * rate);
  const blocks = randomBlocks(random, frames);
  const changes: Record<number, Partial<DistortionDspParams>[]> = {};
  blocks.forEach((_, block) => {
    if (random() > 0.2) return;
    changes[block] = [
      Object.fromEntries(
        DISTORTION_KEYS.filter(() => random() < 0.4).map((key) => [key, valueOf(random, key)])
      ),
    ];
  });
  return {
    rate,
    params: Object.fromEntries(
      DISTORTION_KEYS.map((key) => [key, valueOf(random, key)])
    ) as unknown as DistortionDspParams,
    blocks,
    // (NaN, the infinities and 1e30 too: the core takes them as 0)
    input: randomSignal(random, rate, frames, true),
    changes,
  };
};

describe('distortion wasm core', () => {
  it.each(GOLDEN)('%s: its golden', (name, scenario) => {
    goldens.check(name, run(name, scenario));
  });

  const count = 600 * FUZZ_SCALE;
  it(`renders ${count} random scenarios, finite`, () => {
    for (let seed = 1; seed <= count; seed++) run(`seed ${seed}`, randomScenario(seeded(seed)));
  });

  it('takes NaN and the infinities as 0: finite all along, idle after the sound', () => {
    const [, scenario] = GOLDEN.find(([name]) => name.startsWith('idle')) as [string, Scenario];
    const input = withSpecials(scenario.input);
    const wasm = createDistortionWasm(core, RATE, { params: scenario.params });
    let frame = 0;
    scenario.blocks.forEach((n, block) => {
      const [inL, inR] = [0, 1].map((channel) =>
        Float32Array.from({ length: n }, (_, i) => input(frame + i, channel))
      );
      const outs = [0, 1].map(() => new Float32Array(n));
      wasm.process(inL, inR, outs[0], outs[1]);
      outs.forEach((out) => expectFinite('specials', block, out));
      frame += n;
    });
    expect(wasm.idle).toBe(true);
    wasm.free();
  });

  it('goes idle in the silences, sounds in between', () => {
    const [, scenario] = GOLDEN.find(([name]) => name.startsWith('idle')) as [string, Scenario];
    const wasm = createDistortionWasm(core, RATE, { params: scenario.params });
    let frame = 0;
    const idles: boolean[] = [];
    scenario.blocks.forEach((n) => {
      const input = Float32Array.from({ length: n }, (_, i) => scenario.input(frame + i, 0));
      const outs = [0, 1].map(() => new Float32Array(n));
      wasm.process(input, input, outs[0], outs[1]);
      idles.push(wasm.idle);
      frame += n;
    });
    // idle before the sound (4800 frames), awake through it, idle again after its tail
    expect(idles[0]).toBe(true);
    expect(idles[50]).toBe(false);
    expect(idles.filter((idle) => idle).length).toBeGreaterThan(10);
    expect(idles.at(-1)).toBe(true);
    wasm.free();
  });
});
