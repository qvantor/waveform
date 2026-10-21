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
import { ReverbDspParams } from './reverb-params';
import { REVERB_ERAS } from './reverb-era';
import { createReverbWasm, REVERB_KEYS, ReverbExports } from './reverb-wasm';

// the Rust core of the reverb (dsp/reverb): the bits of every output sample of every block on the golden scenarios
// (their hashes in dsp/goldens/reverb.json), and random ones: finite

const core = wasmCore<ReverbExports>('reverb');
const goldens = createGoldens('reverb');
afterAll(() => goldens.save());

type Reverb = ReturnType<typeof createReverbWasm>;
// a change before a block: params (routed: moved by an envelope), the active flag
interface Change {
  params?: Partial<ReverbDspParams>;
  routed?: boolean;
  active?: boolean;
}
interface Scenario {
  rate: number;
  params: ReverbDspParams;
  active: boolean;
  blocks: number[];
  input: Signal;
  changes?: Record<number, Change[]>;
}

const run = (name: string, { rate, params, active, blocks, input, changes = {} }: Scenario) =>
  runStereo<Reverb>(name, {
    core: createReverbWasm(core, rate, { params, active }),
    blocks,
    input,
    before: (dsp, block) =>
      changes[block]?.forEach((change) => {
        if (change.params) dsp.set(change.params, change.routed);
        if (change.active !== undefined) dsp.setActive(change.active);
      }),
  });

const RATE = 48000;
const era = (index: number) => {
  const { drive, bandwidth, body } = REVERB_ERAS[index];
  return { drive, bandwidth: bandwidth ?? RATE / 2, body };
};
const BASE: ReverbDspParams = {
  lowcut: 20,
  pre: 0.02,
  size: 0.5,
  decay: 2,
  damp: 6000,
  bass: 1,
  depth: 0.2,
  sep: 1,
  er: 0.5,
  ...era(1),
};
const quanta = (seconds: number, rate = RATE) => Array<number>(Math.ceil((seconds * rate) / 128)).fill(128);
const burst =
  (seconds: number, rate = RATE): Signal =>
  (n, channel) =>
    n < seconds * rate ? 0.7 * Math.sin(n / (9 + channel)) + 0.3 * Math.sin(n / 3.1) : 0;
const blockOf = (seconds: number) => Math.floor((seconds * RATE) / 128);

const GOLDEN: [string, Scenario][] = [
  ...REVERB_ERAS.map((_, index): [string, Scenario] => [
    `era ${REVERB_ERAS[index].id}, a loud burst`,
    { rate: RATE, params: { ...BASE, ...era(index) }, active: true, blocks: quanta(0.6), input: burst(0.1) },
  ]),
  [
    'the smallest room, the shortest decay',
    {
      rate: RATE,
      params: { ...BASE, size: 0, decay: 0.1 },
      active: true,
      blocks: quanta(0.4),
      input: burst(0.05),
    },
  ],
  [
    'the largest room, the longest decay, all bass',
    {
      rate: RATE,
      params: { ...BASE, size: 1, decay: 20, bass: 4, depth: 1 },
      active: true,
      blocks: quanta(0.8),
      input: burst(0.05),
    },
  ],
  [
    'a predelay glide',
    {
      rate: RATE,
      params: BASE,
      active: true,
      blocks: quanta(0.5),
      input: burst(0.4),
      changes: { [blockOf(0.1)]: [{ params: { pre: 0.3 } }], [blockOf(0.3)]: [{ params: { pre: 0 } }] },
    },
  ],
  [
    'turned off and on again',
    {
      rate: RATE,
      params: BASE,
      active: true,
      blocks: quanta(0.8),
      input: burst(0.6),
      changes: { [blockOf(0.2)]: [{ active: false }], [blockOf(0.4)]: [{ active: true }] },
    },
  ],
  [
    'drained to idle, woken by new input',
    {
      rate: RATE,
      params: { ...BASE, decay: 0.3 },
      active: true,
      blocks: quanta(1.6),
      input: (n, channel) => (n < 2400 || (n > 72000 && n < 74400) ? burst(1)(n, channel) : 0),
    },
  ],
  [
    'size moved by an envelope every block',
    {
      rate: RATE,
      params: BASE,
      active: true,
      blocks: quanta(0.5),
      input: burst(0.3),
      changes: Object.fromEntries(
        quanta(0.5).map((_, block) => [
          block,
          [{ params: { size: 0.5 + 0.5 * Math.sin(block / 9) }, routed: true }],
        ])
      ),
    },
  ],
  [
    '44.1 kHz, blocks of 1000',
    {
      rate: 44100,
      params: { ...BASE, bandwidth: 22050 },
      active: true,
      blocks: Array<number>(20).fill(1000),
      input: burst(0.1, 44100),
    },
  ],
];

// the params the core stays finite beyond the top of (the others: a decay, a bass or a size beyond theirs make the
// loops gain over unity or read past their buffers, the knobs and the modulation never go there)
const BEYOND: (keyof ReverbDspParams)[] = [
  'lowcut',
  'damp',
  'depth',
  'sep',
  'er',
  'drive',
  'bandwidth',
  'body',
];

// a value of a param: in its range, sometimes beyond its top
const valueOf = (random: Random, key: keyof ReverbDspParams, rate: number) => {
  const range: Record<string, { min: number; max: number }> = {
    ...FX_PARAMS.reverb,
    drive: { min: 0, max: 0.3 },
    bandwidth: { min: 1000, max: rate / 2 },
    body: { min: 0, max: 3 },
  };
  const { min, max } = range[key];
  const top = BEYOND.includes(key) && random() < 0.1 ? 1.5 : 1;
  return min + random() * (max - min) * top;
};
const randomParams = (random: Random, rate: number) =>
  Object.fromEntries(
    REVERB_KEYS.map((key) => [key, valueOf(random, key, rate)])
  ) as unknown as ReverbDspParams;

const randomScenario = (random: Random): Scenario => {
  const rate = pick(random, RATES);
  const frames = Math.floor(random() * 0.4 * rate);
  const blocks = randomBlocks(random, frames);
  const changes: Record<number, Change[]> = {};
  blocks.forEach((_, block) => {
    if (random() > 0.15) return;
    const keys = REVERB_KEYS.filter(() => random() < 0.3);
    changes[block] = [
      {
        params: Object.fromEntries(keys.map((key) => [key, valueOf(random, key, rate)])),
        routed: random() < 0.5,
        ...(random() < 0.2 && { active: random() < 0.6 }),
      },
    ];
  });
  return {
    rate,
    params: randomParams(random, rate),
    active: random() < 0.85,
    blocks,
    // (NaN, the infinities and 1e30 too: the core takes them as 0)
    input: randomSignal(random, rate, frames, true),
    changes,
  };
};

describe('reverb wasm core', () => {
  it.each(GOLDEN)('%s: its golden', (name, scenario) => {
    goldens.check(name, run(name, scenario));
  });

  const count = 300 * FUZZ_SCALE;
  it(`renders ${count} random scenarios, finite`, () => {
    for (let seed = 1; seed <= count; seed++) run(`seed ${seed}`, randomScenario(seeded(seed)));
  });

  it('takes NaN and the infinities as 0: finite all along, drained to idle after the sound', () => {
    const scenario = GOLDEN.find(([name]) => name.startsWith('drained'))?.[1] as Scenario;
    const input = withSpecials(scenario.input);
    const wasm = createReverbWasm(core, RATE, { params: scenario.params, active: true });
    let frame = 0;
    const idles: boolean[] = [];
    scenario.blocks.forEach((n, block) => {
      const [inL, inR] = [0, 1].map((channel) =>
        Float32Array.from({ length: n }, (_, i) => input(frame + i, channel))
      );
      const outs = [0, 1].map(() => new Float32Array(n));
      wasm.process(inL, inR, outs[0], outs[1]);
      outs.forEach((out) => expectFinite('specials', block, out));
      idles.push(wasm.idle);
      frame += n;
    });
    // idle between the two bursts and after the second
    expect(idles.some((idle) => idle)).toBe(true);
    expect(idles.at(-1)).toBe(true);
    wasm.free();
  });

  it('goes idle once its tail has drained', () => {
    const scenario = GOLDEN.find(([name]) => name.startsWith('drained'))?.[1] as Scenario;
    const wasm = createReverbWasm(core, RATE, { params: scenario.params, active: true });
    const idles: boolean[] = [];
    let frame = 0;
    scenario.blocks.forEach((n) => {
      const input = Float32Array.from({ length: n }, (_, i) => scenario.input(frame + i, 0));
      const outs = [0, 1].map(() => new Float32Array(n));
      wasm.process(input, input, outs[0], outs[1]);
      idles.push(wasm.idle);
      frame += n;
    });
    // sounding, then idle for good
    const first = idles.indexOf(true);
    expect(first).toBeGreaterThan(0);
    expect(idles.slice(first).every((idle) => idle)).toBe(true);
    wasm.free();
  });
});
