// first: the Math of JS as jsmath (test-utils/js-math.ts): the inputs and the levels the TS builds the same on every
// machine (Node's own Math differs in the last bits on arm64), so are the goldens
import '../../../../test-utils/js-math';
import { EnvelopeParams, withCurves } from '../envelope/envelope-curve';
import { pick, Random } from '../../../../test-utils/fuzz-signals';
import { createBitsHash, createGoldens, expectFinite, FUZZ_SCALE } from '../../../../test-utils/parity';
import { seeded } from '../../../../test-utils/seeded';
import { wasmCore } from '../../../../test-utils/wasm';
import { buildLevels } from './wavetable-mipmap';
import type { VoiceFilterOptions, VoiceOptions, VoiceOscOptions, VoiceRoute } from './voice-options';
import { HELD_AGAIN_GATE, RELEASE_GATE, VoiceParam } from './wavetable-osc-params';
import {
  createOscScope,
  createTableStoreWasm,
  createVoiceSharedWasm,
  createVoiceWasm,
  OscExports,
} from './wavetable-osc-wasm';

// the Rust core of the wavetable oscillator (dsp/wavetable-osc): a scope of voices on a store and a shared,
// rendered block by block as the worklet does; the bits of every output sample of every voice on the golden
// scenarios (dsp/goldens/wavetable-osc.json), and random scopes: finite, every voice ends, the store and the shared
// give everything back

const core = wasmCore<OscExports>('wavetable-osc');
const goldens = createGoldens('wavetable-osc');
afterAll(() => goldens.save());

// a param of a block: one value, or one per sample
type ParamBlock = (frame: number, n: number) => number | ((frame: number) => number);
type Params = Partial<Record<VoiceParam, ParamBlock>>;

interface ScenarioVoice {
  // the block it is created before (its node), its options and its params
  at: number;
  options: VoiceOptions;
  params: Params;
  // the messages before a block: routes, filter (undefined: none)
  routes?: Record<number, VoiceRoute[]>;
  filters?: Record<number, VoiceFilterOptions | null>;
}

interface Scenario {
  rate: number;
  blocks: number[];
  // the tables: frames of samples, set as version 1 before the first block
  tables: Record<string, number[][]>;
  // new versions (or a removal: null) before a block
  versions?: Record<number, [string, number[][] | null][]>;
  voices: ScenarioVoice[];
  seed: number;
}

const DEFAULTS: Record<VoiceParam, number> = {
  frequency: 440,
  gate: 1,
  position1: 0,
  position2: 0,
  detune1: 0,
  detune2: 0,
  spread1: 0,
  spread2: 0,
  gain1: 0.5,
  gain2: 0.5,
};
const PARAM_NAMES = Object.keys(DEFAULTS) as VoiceParam[];

const blockParams = (voice: ScenarioVoice, frame: number, n: number) =>
  Object.fromEntries(
    PARAM_NAMES.map((name) => {
      const value = voice.params[name]?.(frame, n) ?? DEFAULTS[name];
      return [
        name,
        typeof value === 'number'
          ? Float32Array.of(value)
          : Float32Array.from({ length: n }, (_, i) => value(frame + i)),
      ];
    })
  ) as Record<VoiceParam, Float32Array>;

// the options of a voice of the app: its envelopes with the default shape (synth.ts)
const production = (options: VoiceOptions): VoiceOptions => ({
  ...options,
  envelopes: options.envelopes.map(withCurves),
});

// the scenario on the core, its envelopes curved as the app gives them: the hash of its outputs
const run = (name: string, scenario: Scenario) => {
  const { rate, blocks, tables, versions = {}, voices } = scenario;
  const scope = createOscScope(core);
  const store = createTableStoreWasm(scope);
  const shared = createVoiceSharedWasm(scope);
  const version: Record<string, number> = {};
  // the tables in the store
  const live = new Set<string>();
  const setTable = (table: string, frames: number[][] | null) => {
    version[table] = (version[table] ?? 0) + 1;
    if (frames) {
      store.set(table, version[table], buildLevels(frames));
      live.add(table);
    } else {
      store.remove(table);
      live.delete(table);
    }
  };
  Object.entries(tables).forEach(([table, frames]) => setTable(table, frames));
  const random = seeded(scenario.seed);
  const alive: { voice: ScenarioVoice; wasm: ReturnType<typeof createVoiceWasm> }[] = [];
  const hash = createBitsHash();
  let frame = 0;
  blocks.forEach((n, block) => {
    versions[block]?.forEach(([table, frames]) => setTable(table, frames));
    voices.forEach((voice) => {
      if (voice.at === block)
        alive.push({
          voice,
          wasm: createVoiceWasm(scope, rate, production(voice.options), store, random, shared),
        });
    });
    alive.forEach(({ voice, wasm }) => {
      const routes = voice.routes?.[block];
      if (routes) wasm.setRoutes(routes);
      const filter = voice.filters?.[block];
      if (filter !== undefined) wasm.setFilter(filter);
      const [outL, outR] = [new Float32Array(n), new Float32Array(n)];
      wasm.process(frame, blockParams(voice, frame, n), outL, outR);
      expectFinite(name, block, outL);
      expectFinite(name, block, outR);
      hash.add(outL);
      hash.add(outR, false);
    });
    for (let i = alive.length - 1; i >= 0; i--) if (alive[i].wasm.ended) alive.splice(i, 1);
    frame += n;
  });
  // the voices still playing end (their processors are stopped): every version and mix table is given back
  alive.forEach(({ wasm }) => wasm.end());
  expect({ name, ...shared.stats() }).toMatchObject({ name, voices: 0, unison: 0 });
  expect({ name, ...store.stats() }).toMatchObject({ name, tables: live.size, versions: live.size });
  return hash.digest();
};

// --- tables ---

const cycle = (size: number, harmonics: [number, number, number][]) =>
  Array.from({ length: size }, (_, n) =>
    harmonics.reduce((sum, [k, a, phase]) => sum + a * Math.sin((2 * Math.PI * k * n) / size + phase), 0)
  );
const sawFrame = (size: number, count: number, shift = 0) =>
  cycle(
    size,
    Array.from({ length: count }, (_, i): [number, number, number] => [i + 1, 1 / (i + 1), shift * (i + 1)])
  );
const SAW = sawFrame(2048, 1023);
const SINE = cycle(2048, [[1, 1, 0]]);
const SQUARE = cycle(
  2048,
  Array.from({ length: 512 }, (_, i): [number, number, number] => [2 * i + 1, 1 / (2 * i + 1), 0])
);

const FLAT: EnvelopeParams = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
const ENV: EnvelopeParams = { attack: 0.01, hold: 0.005, decay: 0.05, sustain: 0.6, release: 0.03 };
const osc = (config: Partial<VoiceOscOptions> = {}): VoiceOscOptions => ({
  table: 'a',
  unison: 1,
  phase: 0,
  phaseRand: 0,
  ...config,
});
const note = (options: Partial<VoiceOptions> = {}): VoiceOptions => ({
  osc: [osc(), null],
  start: 0,
  envelopes: [FLAT, FLAT, FLAT],
  envStart: 0,
  phrase: 0,
  routes: [],
  filter: null,
  ...options,
});
const RATE = 48000;
const quanta = (seconds: number, rate = RATE) => Array<number>(Math.ceil((seconds * rate) / 128)).fill(128);
const constant = (value: number) => () => value;
const perSample = (f: (frame: number) => number) => () => f;
const gateAt =
  (stop: number, value = 0) =>
  (frame: number, n: number) =>
    frame + n <= stop ? 1 : (i: number) => (i < stop ? 1 : value);

const GOLDEN: [string, Scenario][] = [
  ...[1, 2, 5, 8].flatMap((unison) =>
    [0, 1].map((phaseRand): [string, Scenario] => [
      `unison ${unison}, phase rand ${phaseRand}`,
      {
        rate: RATE,
        blocks: quanta(0.1),
        tables: { a: [SAW] },
        voices: [
          {
            at: 0,
            options: note({ osc: [osc({ unison, phaseRand }), null] }),
            params: { spread1: constant(30) },
          },
        ],
        seed: unison,
      },
    ])
  ),
  [
    'a position that moves, down across the frames, then stays',
    {
      rate: RATE,
      blocks: quanta(0.2),
      tables: { a: [SINE, SAW, SQUARE, SAW.map((v) => -v)] },
      voices: [
        {
          at: 0,
          options: note(),
          params: {
            frequency: constant(110),
            position1: (frame) => (frame < 6000 ? perSample((f) => 1 - f / 6000)() : 0.4),
          },
        },
      ],
      seed: 1,
    },
  ],
  [
    'a glide, above the nyquist and back',
    {
      rate: RATE,
      blocks: quanta(0.2),
      tables: { a: [SAW] },
      voices: [{ at: 0, options: note(), params: { frequency: perSample((f) => 50 * 2 ** (f / 900)) } }],
      seed: 1,
    },
  ],
  [
    'released, its envelope to 0',
    {
      rate: RATE,
      blocks: quanta(0.2),
      tables: { a: [SAW] },
      voices: [
        {
          at: 0,
          options: note({ envelopes: [ENV, FLAT, FLAT] }),
          params: { gate: gateAt(3000, RELEASE_GATE + 0.04) },
        },
      ],
      seed: 1,
    },
  ],
  [
    'started again (mono), then stolen',
    {
      rate: RATE,
      blocks: quanta(0.2),
      tables: { a: [SAW] },
      voices: [
        {
          at: 0,
          options: note({ envelopes: [ENV, ENV, FLAT] }),
          params: {
            gate: (frame, n) =>
              frame + n <= 2000 ? 1 : (i) => (i < 2000 ? 1 : i < 4500 ? HELD_AGAIN_GATE : i < 7000 ? 1 : -1),
          },
        },
      ],
      seed: 1,
    },
  ],
  [
    'a legato phrase and a voice that came late',
    {
      rate: RATE,
      blocks: quanta(0.3),
      tables: { a: [SAW], b: [SQUARE] },
      voices: [
        {
          at: 0,
          options: note({ envelopes: [ENV, FLAT, FLAT], phrase: 1 }),
          params: { gate: gateAt(6000, RELEASE_GATE + 0.12) },
        },
        {
          at: 20,
          options: note({
            osc: [osc({ table: 'b', unison: 3, phaseRand: 0.5 }), null],
            start: 2560 / RATE,
            envStart: 0,
            envelopes: [ENV, FLAT, FLAT],
            phrase: 1,
          }),
          params: { frequency: constant(330), spread1: constant(12) },
        },
        {
          at: 30,
          options: note({ start: 3000 / RATE, envStart: 3000 / RATE, phrase: 2 }),
          params: { frequency: constant(550) },
        },
      ],
      seed: 4,
    },
  ],
  ...(
    ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'] as const
  ).map((type): [string, Scenario] => [
    `the ${type} filter with its cutoff moved by ENV 2`,
    {
      rate: RATE,
      blocks: quanta(0.15),
      tables: { a: [SAW] },
      voices: [
        {
          at: 0,
          options: note({
            envelopes: [FLAT, { attack: 0.03, hold: 0, decay: 0.05, sustain: 0.3, release: 0.1 }, FLAT],
            filter: { type, cutoff: 800, resonance: 6, gain: 6 },
            routes: [{ env: 1, param: 'cutoff', amount: 3, min: 20, max: 20000, log: true }],
          }),
          params: { frequency: constant(110) },
          filters: { 20: { type, cutoff: 3000, resonance: 3, gain: -6 } },
        },
      ],
      seed: 1,
    },
  ]),
  [
    'routes to the wave, the gain and the spread, changed on the note',
    {
      rate: RATE,
      blocks: quanta(0.2),
      tables: { a: [SINE, SAW, SQUARE] },
      voices: [
        {
          at: 0,
          options: note({
            osc: [osc({ unison: 4 }), osc({ unison: 2, phase: 0.3 })],
            envelopes: [ENV, { attack: 0.05, hold: 0, decay: 0.1, sustain: 0.2, release: 0.2 }, ENV],
            routes: [
              { env: 1, param: 'position1', amount: 1, min: 0, max: 1 },
              { env: 2, param: 'gain2', amount: -0.5, min: 0, max: 1 },
              { env: 1, param: 'spread1', amount: 40, min: 0, max: 100 },
            ],
          }),
          params: { spread1: constant(10), detune2: constant(-1200) },
          routes: { 30: [{ env: 2, param: 'position1', amount: -0.5, min: 0, max: 1 }] },
        },
      ],
      seed: 2,
    },
  ],
  [
    'a new version of the table, crossfaded; the table removed',
    {
      rate: RATE,
      blocks: quanta(0.2),
      tables: { a: [SAW] },
      versions: { 10: [['a', [SQUARE]]], 40: [['a', null]] },
      voices: [
        {
          at: 0,
          options: note({ osc: [osc({ unison: 3, phaseRand: 1 }), null] }),
          params: { spread1: constant(20) },
        },
        {
          at: 45,
          options: note({ start: (45 * 128) / RATE, envStart: (45 * 128) / RATE, phrase: 3 }),
          params: {},
        },
      ],
      seed: 5,
    },
  ],
  [
    'a table of one frame, a silent table',
    {
      rate: RATE,
      blocks: quanta(0.1),
      tables: { a: [SAW], z: [[0, 0]] },
      voices: [
        {
          at: 0,
          options: note({ osc: [osc(), osc({ table: 'z', unison: 2 })] }),
          params: { position1: perSample((f) => (f % 500) / 500) },
        },
      ],
      seed: 1,
    },
  ],
  [
    'a chord over the mix budget',
    {
      rate: RATE,
      blocks: quanta(0.1),
      tables: { a: [SAW, SQUARE], b: [SQUARE] },
      voices: Array.from({ length: 12 }, (_, i) => ({
        at: 0,
        options: note({
          osc: [osc({ unison: 8, phaseRand: 1, phase: 0.5 }), osc({ table: 'b', unison: 8, phaseRand: 1 })],
          phrase: 10 + i,
        }),
        params: {
          frequency: constant(110 * 2 ** (i / 12)),
          position1: constant(0.5),
          spread1: constant(25),
          spread2: constant(35),
          detune2: constant(-1200),
        },
      })),
      seed: 6,
    },
  ],
  [
    '96 kHz, blocks of 256',
    {
      rate: 96000,
      blocks: Array<number>(40).fill(256),
      tables: { a: [SAW, SINE] },
      voices: [
        {
          at: 0,
          options: note({ osc: [osc({ unison: 6, phaseRand: 1 }), null] }),
          params: { spread1: constant(15), position1: constant(0.3) },
        },
      ],
      seed: 7,
    },
  ],
];

// --- random scenarios ---

const between = (random: Random, min: number, max: number) => min + random() * (max - min);
const KNOBS: [string, number, number, boolean?][] = [
  ['position1', 0, 1],
  ['spread1', 0, 100],
  ['gain1', 0, 1],
  ['position2', 0, 1],
  ['spread2', 0, 100],
  ['gain2', 0, 1],
  ['cutoff', 20, 20000, true],
  ['resonance', -12, 24],
  ['gain', -24, 24],
  ['detune1', -2400, 2400],
];
const FILTERS = [
  'lowpass',
  'highpass',
  'bandpass',
  'lowshelf',
  'highshelf',
  'peaking',
  'notch',
  'allpass',
] as const;

const randomEnvelope = (random: Random): EnvelopeParams => {
  const time = () =>
    random() < 0.3 ? 0 : random() < 0.7 ? between(random, 0, 0.05) : between(random, 0, 0.5);
  return {
    attack: time(),
    hold: time(),
    decay: time(),
    sustain: random() < 0.2 ? pick(random, [0, 1]) : random(),
    release: time(),
  };
};
const randomRoutes = (random: Random): VoiceRoute[] =>
  Array.from({ length: Math.floor(random() * 4) }, () => {
    const [param, min, max, log] = pick(random, KNOBS);
    return {
      env: Math.floor(random() * 3),
      param,
      amount: (random() * 2 - 1) * (log ? 4 : max - min),
      min,
      max,
      log,
    };
  });
const randomFilter = (random: Random): VoiceFilterOptions | null =>
  random() < 0.4
    ? null
    : {
        type: pick(random, FILTERS),
        cutoff: 20 * 2 ** (random() * 10),
        resonance: between(random, -6, 20),
        gain: between(random, -18, 18),
      };
const randomFrames = (random: Random) =>
  Array.from({ length: 1 + Math.floor(random() * (random() < 0.5 ? 1 : 6)) }, (_, k) => {
    const size = pick(random, [2048, 2048, 1024, 256, 64, 16]);
    return sawFrame(size, Math.max(1, Math.floor(random() * (size / 2 - 1))), k * random());
  });
// a param of the blocks: constant, a ramp, or an LFO over the samples
const randomParam = (random: Random, min: number, max: number, log = false): ParamBlock => {
  const value = () => (log ? min * (max / min) ** random() : between(random, min, max));
  const kind = random();
  if (kind < 0.6) {
    const v = value();
    return () => v;
  }
  const [a, b] = [value(), value()];
  const period = between(random, 200, 20000);
  if (kind < 0.8) return () => (f) => a + (b - a) * (0.5 + 0.5 * Math.sin(f / period));
  // a value that steps once in a while (the voice is steady between)
  return (frame) => (Math.floor(frame / period) % 2 ? a : b);
};
const randomGate = (random: Random, frames: number): ParamBlock => {
  const events: [number, number][] = [];
  let at = Math.floor(random() * frames);
  while (at < frames && events.length < 4) {
    const kind = random();
    const value =
      kind < 0.3
        ? RELEASE_GATE + random() * 0.2
        : kind < 0.45
        ? 0
        : kind < 0.65
        ? HELD_AGAIN_GATE
        : kind < 0.8
        ? 1
        : -1;
    events.push([at, value]);
    at += Math.floor(random() * frames);
  }
  const valueAt = (i: number) => {
    let value = 1;
    for (const [frame, v] of events) if (i >= frame) value = v;
    return value;
  };
  return (frame, n) => {
    const first = valueAt(frame);
    for (let i = 1; i < n; i++) if (valueAt(frame + i) !== first) return valueAt;
    return first;
  };
};

const randomScenario = (random: Random, seed: number): Scenario => {
  const rate = pick(random, [44100, 48000, 48000, 96000]);
  const blocks = Array.from({ length: 8 + Math.floor(random() * 40) }, () =>
    random() < 0.95 ? 128 : pick(random, [64, 256, 512])
  );
  const frames = blocks.reduce((a, b) => a + b, 0);
  const tables: Record<string, number[][]> = { a: randomFrames(random), b: randomFrames(random) };
  const versions: Scenario['versions'] = {};
  if (random() < 0.3)
    versions[Math.floor(random() * blocks.length)] = [
      [pick(random, ['a', 'b', 'c']), random() < 0.8 ? randomFrames(random) : null],
    ];
  const voices = Array.from({ length: 1 + Math.floor(random() * 4) }, (_, index): ScenarioVoice => {
    const at = Math.floor(random() * blocks.length * 0.6);
    const atFrame = blocks.slice(0, at).reduce((a, b) => a + b, 0);
    // on time, a little later, or late (its node came after its start)
    const start = Math.max(0, atFrame + Math.floor((random() - 0.3) * 400)) / rate;
    const legato = index > 0 && random() < 0.25;
    const oscOf = (): VoiceOscOptions | null =>
      random() < 0.2
        ? null
        : {
            table: pick(random, ['a', 'b', 'c']),
            unison: 1 + Math.floor(random() * 8),
            phase: random(),
            phaseRand: random() < 0.5 ? 0 : random(),
          };
    const routes = randomRoutes(random);
    const message: Record<number, VoiceRoute[]> = {};
    if (random() < 0.3) message[at + Math.floor(random() * 10)] = randomRoutes(random);
    const filters: Record<number, VoiceFilterOptions | null> = {};
    if (random() < 0.3) filters[at + Math.floor(random() * 10)] = randomFilter(random);
    return {
      at,
      options: {
        osc: [oscOf(), oscOf()],
        start,
        envelopes: [randomEnvelope(random), randomEnvelope(random), randomEnvelope(random)],
        envStart: legato ? Math.max(0, start - random() * 0.05) : start,
        phrase: legato ? 0 : index,
        routes,
        filter: randomFilter(random),
      },
      params: {
        frequency: randomParam(random, 20, random() < 0.1 ? 40000 : 8000, true),
        gate: randomGate(random, frames),
        position1: randomParam(random, 0, 1),
        position2: randomParam(random, 0, 1),
        detune1: randomParam(random, -1200, 1200),
        detune2: randomParam(random, -2400, 0),
        spread1: randomParam(random, 0, random() < 0.2 ? 0 : 60),
        spread2: randomParam(random, 0, 60),
        gain1: randomParam(random, 0, 1),
        gain2: randomParam(random, 0, 1),
      },
      routes: message,
      filters,
    };
  });
  return { rate, blocks, tables, versions, voices, seed };
};

describe('wavetable oscillator wasm core', () => {
  it.each(GOLDEN)('%s: its golden', (name, scenario) => {
    goldens.check(name, run(name, scenario));
  });

  const count = 150 * FUZZ_SCALE;
  it(`renders ${count} random scopes, finite, every voice ending`, () => {
    for (let seed = 1; seed <= count; seed++) run(`seed ${seed}`, randomScenario(seeded(seed * 7919), seed));
  });
});
