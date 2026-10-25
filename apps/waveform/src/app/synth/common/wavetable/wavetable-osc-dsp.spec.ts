import { readFileSync } from 'fs';
import { join } from 'path';
import FFT from 'fft.js';
import { frequencyResponseDb } from '@waveform/ui-kit';
import { EnvelopeParams, envelopeValue } from '../envelope/envelope-curve';
import { withCurves } from '../../../../test-utils/envelopes';
import { seeded, VOICE_DEFAULTS } from '../../../../test-utils/voice-dsp';
import { wasmCore } from '../../../../test-utils/wasm';
import { buildLevels } from './wavetable-mipmap';
import type { WavetableLevels } from './wavetable-levels';
import {
  TableStoreStats,
  UNISON_SHAPE,
  UnisonShape,
  UnisonStack,
  VoiceFilterOptions,
  VoiceOptions,
  VoiceOscOptions,
  VoiceRoute,
  VoiceStats,
  VoiceVelocity,
} from './voice-options';
import { RELEASE_GATE, VoiceParam } from './wavetable-osc-params';
import {
  createOscScope,
  createTableStoreWasm,
  createVoiceSharedWasm,
  createVoiceWasm,
  OscExports,
  TableStoreWasm,
  VoiceSharedWasm,
} from './wavetable-osc-wasm';
// the Rust core (dsp/wavetable-osc), its stores and shareds in one instance for the spec (a scope), through `core`
interface CoreEntry {
  levels: WavetableLevels;
}
interface CoreStore {
  set(table: string, version: number, levels: WavetableLevels): unknown;
  remove(table: string): void;
  latest(table: string): CoreEntry | null;
  acquire(entry: CoreEntry): CoreEntry;
  release(entry: CoreEntry): void;
  stats(): TableStoreStats;
}
interface CoreShared {
  stats(): VoiceStats;
}
interface CoreVoice {
  process(
    frame: number,
    params: Record<VoiceParam, Float32Array>,
    outL: Float32Array,
    outR: Float32Array
  ): boolean;
  setRoutes(routes: VoiceRoute[]): void;
  setFilter(filter: VoiceFilterOptions | null): void;
  setVelocity(velocity: VoiceVelocity): void;
  end(): void;
  readonly ended: boolean;
  startFrame: number;
  readonly startedAt: number;
}
interface Core {
  storeWith(tables: Record<string, number[][]>): { store: CoreStore; freed: unknown[] };
  createTableStore(onFree?: (levels: WavetableLevels) => void): CoreStore;
  createVoiceShared(): CoreShared;
  createVoiceDsp(
    rate: number,
    options: VoiceOptions,
    store: CoreStore,
    random: () => number,
    shared: CoreShared
  ): CoreVoice;
}
const scope = createOscScope(wasmCore<OscExports>('wavetable-osc'));
const core: Core = {
  storeWith: (tables) => {
    const freed: unknown[] = [];
    const store = createTableStoreWasm(scope, (levels) => freed.push(levels));
    Object.entries(tables).forEach(([id, frames]) => store.set(id, 1, buildLevels(frames)));
    return { store, freed };
  },
  createTableStore: (onFree) => createTableStoreWasm(scope, onFree ?? (() => undefined)),
  createVoiceShared: () => createVoiceSharedWasm(scope),
  createVoiceDsp: (rate, options, store, random, shared) =>
    createVoiceWasm(scope, rate, options, store as TableStoreWasm, random, shared as VoiceSharedWasm),
};

const RATE = 48000;
const BLOCK = 128;
// an Audio Unit playing tables of ours (scripts/renders/run.mjs)
const MEASURED_UNISON: {
  modes: Record<string, number[]>;
  stacks: Record<string, { step: number; detune: number; side: string }[]>;
} = JSON.parse(readFileSync(join(__dirname, '../../../../../../../dsp/measurements/unison.json'), 'utf8'));
const MEASURED_FRAMES: {
  played: Record<'3' | '4', { edge: number; below: number; above: number }[]>;
} = JSON.parse(readFileSync(join(__dirname, '../../../../../../../dsp/measurements/frames.json'), 'utf8'));

const cycle = (size: number, harmonics: [number, number, number?][]) =>
  Array.from({ length: size }, (_, n) =>
    harmonics.reduce((sum, [k, a, phase = 0]) => sum + a * Math.sin((2 * Math.PI * k * n) / size + phase), 0)
  );
const SAW_HARMONICS = Array.from({ length: 1023 }, (_, i): [number, number] => [i + 1, 1 / (i + 1)]);
const saw = cycle(2048, SAW_HARMONICS);
const sine = cycle(2048, [[1, 1]]);
const square = cycle(
  2048,
  Array.from({ length: 512 }, (_, i): [number, number] => [2 * i + 1, 1 / (2 * i + 1)])
);

type ParamValue = number | ((frame: number) => number);
type Params = Partial<Record<VoiceParam, ParamValue>>;
const DEFAULTS = VOICE_DEFAULTS;

const osc = (config: Partial<VoiceOscOptions> = {}): VoiceOscOptions => ({
  table: 'a',
  unison: 1,
  phase: 0,
  phaseRand: 0,
  ...config,
});

// the gate param from `stop` on (setValueAtTime): released (0 at that sample, RELEASE_GATE + h h seconds after
// the first sample), below 0 for a stolen voice
const gateAt =
  (stop: number, value = 0) =>
  (frame: number) =>
    frame < stop ? 1 : value;

// ENV 1 at full level from the start, ended at once by the gate: the voice as the oscillators play it
const FLAT: EnvelopeParams = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };

interface RenderOptions {
  store: CoreStore;
  oscs?: (VoiceOscOptions | null)[];
  params?: Params;
  frames: number;
  start?: number;
  // ENV 1 and the seconds it starts at (the start of the note by default), ENV 2 and 3, the routes
  envelope?: EnvelopeParams;
  envStart?: number;
  envelopes?: EnvelopeParams[];
  // its phrase (0 by default: a render has its own shared)
  phrase?: number;
  routes?: VoiceRoute[];
  filter?: VoiceFilterOptions | null;
  // its velocity (none: no VELO, the amp 1)
  velocity?: VoiceVelocity;
  random?: () => number;
  rate?: number;
  // the frame of the first block processed (its node came late), 0 by default
  from?: number;
  // called before the block at that frame
  before?: (frame: number, dsp: CoreVoice) => void;
  // the resources the voices of a context share; a render has its own by default
  shared?: CoreShared;
}

// renders a voice block by block: a param is a number (one value per block) or a function of the frame (one
// value per sample)
const render = ({
  store,
  oscs = [osc()],
  params = {},
  frames,
  start = 0,
  envelope = FLAT,
  envStart = start,
  envelopes = [FLAT, FLAT],
  phrase = 0,
  routes = [],
  filter = null,
  velocity,
  random,
  rate = RATE,
  from = 0,
  before,
  shared = core.createVoiceShared(),
}: RenderOptions) => {
  const dsp = core.createVoiceDsp(
    rate,
    {
      osc: oscs,
      start,
      envelopes: [envelope, ...envelopes],
      envStart,
      phrase,
      routes,
      filter,
      ...(velocity && { velocity }),
    },
    store,
    random ?? seeded(1),
    shared
  );
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  let endedAt = -1;
  for (let frame = from; frame < frames; frame += BLOCK) {
    before?.(frame, dsp);
    const values = Object.fromEntries(
      (Object.keys(DEFAULTS) as VoiceParam[]).map((name) => {
        const value = params[name] ?? DEFAULTS[name];
        return [
          name,
          typeof value === 'number'
            ? Float32Array.of(value)
            : Float32Array.from({ length: BLOCK }, (_, i) => value(frame + i)),
        ];
      })
    ) as Record<VoiceParam, Float32Array>;
    const alive = dsp.process(frame, values, outL, outR);
    left.set(outL.subarray(0, Math.min(BLOCK, frames - frame)), frame);
    right.set(outR.subarray(0, Math.min(BLOCK, frames - frame)), frame);
    if (!alive && endedAt < 0) endedAt = frame;
  }
  return { left, right, endedAt, dsp };
};

const rms = (signal: ArrayLike<number>, from = 0, to = signal.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += signal[i] ** 2;
  return Math.sqrt(sum / (to - from));
};
const db = (ratio: number) => 20 * Math.log10(ratio);
const maxStep = (signal: Float32Array, from = 1, to = signal.length) => {
  let max = 0;
  for (let i = Math.max(1, from); i < to; i++) max = Math.max(max, Math.abs(signal[i] - signal[i - 1]));
  return max;
};

// the amplitude of a tone of `frequency` in a signal (a Hann windowed DFT at that frequency)
const toneAmplitude = (signal: Float32Array, frequency: number, rate = RATE) => {
  let re = 0;
  let im = 0;
  let sum = 0;
  const n = signal.length;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const phase = (2 * Math.PI * frequency * i) / rate;
    re += signal[i] * w * Math.cos(phase);
    im -= signal[i] * w * Math.sin(phase);
    sum += w;
  }
  return (2 * Math.hypot(re, im)) / sum;
};

// the power spectrum of SIZE samples (rectangular window: the tests play pitches whose period divides SIZE)
const SIZE = 65536;
const powerSpectrum = (signal: Float32Array) => {
  const fft = new FFT(SIZE);
  const out = fft.createComplexArray();
  fft.realTransform(out, Array.from(signal.subarray(signal.length - SIZE)));
  return Array.from({ length: SIZE / 2 }, (_, k) => out[2 * k] ** 2 + out[2 * k + 1] ** 2);
};

// a pitch on the bins of SIZE samples: its harmonics are the bins h · bin
const binPitch = (bin: number, rate = RATE) => (bin * rate) / SIZE;

const harmonicAnalysis = (signal: Float32Array, bin: number) => {
  const spectrum = powerSpectrum(signal);
  let harmonics = 0;
  let other = 0;
  let worst = 0;
  let highest = 0;
  const fundamental = spectrum[bin];
  spectrum.forEach((power, k) => {
    if (k === 0) return;
    if (k % bin === 0) {
      harmonics += power;
      if (power > fundamental * 1e-12) highest = k / bin;
    } else {
      other += power;
      worst = Math.max(worst, power);
    }
  });
  return {
    aliasing: 10 * Math.log10(other / harmonics),
    worstSpur: 10 * Math.log10(worst / fundamental),
    highest,
  };
};

// zero crossings upwards, interpolated: the frequency of a sine
const measureFrequency = (signal: Float32Array, rate = RATE) => {
  const crossings: number[] = [];
  for (let i = 1; i < signal.length; i++)
    if (signal[i - 1] < 0 && signal[i] >= 0)
      crossings.push(i - 1 + -signal[i - 1] / (signal[i] - signal[i - 1]));
  return ((crossings.length - 1) * rate) / (crossings[crossings.length - 1] - crossings[0]);
};

describe('the wavetable voice', () => {
  describe('pitch', () => {
    it.each([55, 440, 3520])('plays %s Hz within 0.01 cent', (frequency) => {
      const { store } = core.storeWith({ a: [sine] });
      const { left } = render({ store, params: { frequency }, frames: 10 * RATE });
      const cents = 1200 * Math.log2(measureFrequency(left) / frequency);
      expect(Math.abs(cents)).toBeLessThan(0.01);
    });

    it('adds the detune of the oscillator in cents', () => {
      const { store } = core.storeWith({ a: [sine] });
      const { left } = render({ store, params: { frequency: 220, detune1: 1200 }, frames: RATE });
      expect(measureFrequency(left)).toBeCloseTo(440, 2);
    });

    it('steps a changing pitch every 32 samples within 0.1 cent', () => {
      const { store } = core.storeWith({ a: [sine] });
      // a vibrato of ±100 cents at 6 Hz against the same pitch per sample
      const detune = (frame: number) => 100 * Math.sin((2 * Math.PI * 6 * frame) / RATE);
      const { left } = render({ store, params: { frequency: 440, detune1: detune }, frames: RATE });
      let phase = 0;
      let maxError = 0;
      for (let i = 0; i < RATE; i++) {
        const expected = Math.sin(2 * Math.PI * phase);
        maxError = Math.max(maxError, Math.abs(left[i] - expected));
        phase += (440 * 2 ** (detune(i) / 1200)) / RATE;
        phase -= Math.floor(phase);
      }
      // 0.1 cent of phase drift at 440 Hz over a second would be far above this
      expect(maxError).toBeLessThan(2e-3);
    });
  });

  describe('band limit', () => {
    // a native OscillatorNode with the PeriodicWave of the saw at 48 kHz (Chrome 133 and WebKit 18.2 alike,
    // scripts/bench-osc): the bins of the analysis (55, 110, 220, 1046, 3520, 7040 Hz), its aliasing and worst
    // spur (dB) and the number of its highest harmonic
    const NATIVE: [number, number, number, number][] = [
      [75, -72.2, -93.0, 406],
      [150, -80.8, -99.3, 203],
      [300, -88.5, -104.3, 101],
      [1428, -108.3, -118.5, 20],
      [4806, -124.5, -130.1, 6],
      [9612, -132.2, -136.7, 3],
    ];

    it.each(NATIVE)(
      'keeps the aliasing of a saw at bin %s within 1 dB of a native oscillator, as bright',
      (bin, aliasing, spur, highest) => {
        const { store } = core.storeWith({ a: [saw] });
        const { left } = render({ store, params: { frequency: binPitch(bin) }, frames: SIZE + 4096 });
        const result = harmonicAnalysis(left, bin);
        expect(result.aliasing).toBeLessThanOrEqual(aliasing + 1);
        expect(result.worstSpur).toBeLessThanOrEqual(spur + 1);
        expect(result.highest).toBeGreaterThanOrEqual(highest);
        expect(result.highest * binPitch(bin)).toBeLessThan(RATE / 2);
      }
    );

    it('plays the harmonics of the additive synthesis at their level', () => {
      const { store } = core.storeWith({ a: [saw] });
      const bin = 1428;
      const { left } = render({ store, params: { frequency: binPitch(bin) }, frames: SIZE + 4096 });
      const spectrum = powerSpectrum(left);
      // the saw at its volume: harmonic h at 1/h (the levels below their crossfade)
      for (const h of [1, 2, 5, 10]) {
        const amplitude = (2 * Math.sqrt(spectrum[h * bin])) / SIZE;
        expect(amplitude).toBeCloseTo(1 / h, 3);
      }
    });

    it('fades a fundamental above the nyquist out to silence', () => {
      const { store } = core.storeWith({ a: [saw] });
      const { left } = render({ store, params: { frequency: 30000 }, frames: 4096 });
      expect(rms(left)).toBe(0);
    });
  });

  describe('position', () => {
    const table = Array.from({ length: 256 }, (_, k) =>
      cycle(2048, [
        [1, 1],
        [1 + (k % 7), 0.5, k],
      ])
    );

    it('plays exactly frame k at k / (N - 1)', () => {
      const { store } = core.storeWith({ a: table, b: [table[100]] });
      const position = Math.fround(100 / 255);
      const { left } = render({ store, params: { position1: position }, frames: 4096 });
      const { left: alone } = render({ store, oscs: [osc({ table: 'b' })], frames: 4096 });
      expect(left).toEqual(alone);
    });

    // dsp/measurements/frames.json: the frame just below and above each edge k / N of the position
    it.each(['3', '4'])('plays one frame of %s, never a mix: q = share × N in (k, k + 1] is frame k', (n) => {
      const count = Number(n);
      const frames = [sine, square, saw, sine.map((v) => -v)].slice(0, count);
      const { store } = core.storeWith({ a: frames });
      const at = (position: number) => render({ store, params: { position1: position }, frames: 1024 }).left;
      const alone = (k: number) => at(k / (count - 1));
      for (const { edge, below, above } of MEASURED_FRAMES.played[n as '3' | '4']) {
        expect(at(edge - 1e-4)).toEqual(alone(below));
        expect(at(edge + 1e-4)).toEqual(alone(above));
      }
    });

    it('steps to the next frame at the first sample a moving position plays it, no mix between', () => {
      const { store } = core.storeWith({ a: [sine, square, saw] });
      // q from 0.6 to 1.8 over 512 samples: past 1 (frame 1) from sample 171
      const { left } = render({
        store,
        params: { position1: (frame) => (0.6 + (1.2 * frame) / 512) / 3 },
        frames: 512,
      });
      const still = (k: number) => render({ store, params: { position1: k / 2 }, frames: 512 }).left;
      const [zero, one] = [still(0), still(1)];
      // (a moving position plays the levels themselves, a still one their mix)
      for (let i = 0; i < 512; i++) expect(left[i]).toBeCloseTo(i < 171 ? zero[i] : one[i], 3);
    });

    it('clamps a position outside 0..1', () => {
      const { store } = core.storeWith({ a: [sine, square], s: [sine], q: [square] });
      const below = render({ store, params: { position1: -0.5 }, frames: 512 }).left;
      const above = render({ store, params: { position1: (frame) => 2 + frame }, frames: 512 }).left;
      expect(below).toEqual(render({ store, params: { position1: 0 }, frames: 512 }).left);
      above.forEach((value) => expect(Number.isFinite(value)).toBe(true));
      const q = render({ store, oscs: [osc({ table: 'q' })], frames: 512 }).left;
      // (the moving position plays the levels themselves, the constant one their mix)
      above.forEach((value, i) => expect(value).toBeCloseTo(q[i], 3));
    });

    it('plays a table of one frame at any position', () => {
      const { store } = core.storeWith({ a: [square], q: [square] });
      const { left } = render({ store, params: { position1: (frame) => frame / 512 }, frames: 512 });
      expect(left).toEqual(render({ store, oscs: [osc({ table: 'q' })], frames: 512 }).left);
    });
  });

  describe('glide', () => {
    it('glides 55 Hz to 7 kHz without steps of the waveform', () => {
      const { store } = core.storeWith({ a: [saw] });
      const seconds = 2;
      const frequency = (frame: number) => 55 * (7000 / 55) ** Math.min(1, frame / (seconds * RATE));
      const { left } = render({ store, params: { frequency }, frames: seconds * RATE });
      // the steepest of the pitches it passes (a pitch just below a level has one more harmonic)
      const stationary = Array.from({ length: 64 }, (_, i) =>
        maxStep(render({ store, params: { frequency: 55 * (7000 / 55) ** (i / 63) }, frames: 2048 }).left)
      );
      expect(maxStep(left)).toBeLessThanOrEqual(1.1 * Math.max(...stationary));
    });

    // level q is the whole tone from pitch range x = q (1 + 3·log2(1024 · f / nyquist)) on, crossfaded into
    // level q + 1 up to x = q + 1: a harmonic between their counts fades out over a third of an octave
    it('crossfades the levels: no step of the harmonics at a level boundary', () => {
      const { store } = core.storeWith({ a: [saw] });
      const pitch = (x: number) => (RATE / 2 / 1024) * 2 ** ((x - 1) / 3);
      const play = (x: number) => render({ store, params: { frequency: pitch(x) }, frames: RATE / 2 }).left;
      // level 10 keeps 101 harmonics, level 11 80
      // harmonic h of the note at x, against its level in the saw
      const harmonic = (x: number, h: number) => toneAmplitude(play(x), h * pitch(x)) * h;
      for (const h of [1, 50, 90, 101]) {
        expect(harmonic(10 - 0.002, h)).toBeCloseTo(1, 1);
        expect(harmonic(10 + 0.002, h)).toBeCloseTo(1, 1);
      }
      // harmonic 90 is in level 10, not in level 11: half of it in the middle
      expect(harmonic(10.5, 90)).toBeCloseTo(0.5, 1);
      expect(harmonic(10.5, 70)).toBeCloseTo(1, 1);
    });
  });

  describe('table versions', () => {
    it('crossfades a playing voice into a new version within 10 ms', () => {
      const { store, freed } = core.storeWith({ a: [sine], q: [square] });
      const old = store.latest('a');
      const switchAt = 4096;
      const { left } = render({
        store,
        frames: 16384,
        before: (frame) => frame === switchAt && store.set('a', 2, buildLevels([square])),
      });
      const { left: after } = render({ store, oscs: [osc({ table: 'q' })], frames: 16384 });
      const { left: before } = render({ store, oscs: [osc({ table: 'a' })], frames: 16384 });
      // the same phases: from 10 ms after the switch on it is the new table, sample by sample
      const done = switchAt + 0.01 * RATE + BLOCK;
      for (let i = done; i < 16384; i++) expect(left[i]).toBeCloseTo(after[i], 4);
      expect(maxStep(left)).toBeLessThanOrEqual(1.1 * Math.max(maxStep(before), maxStep(after)));
      // the old version is freed once no voice plays it
      expect(freed).toContain(old?.levels);
    });

    it('starts with a sine until the table arrives', () => {
      const store = core.createTableStore();
      const { left } = render({ store, params: { frequency: 375 }, frames: 1024 });
      const { store: sineStore } = core.storeWith({ a: [sine] });
      const { left: expected } = render({ store: sineStore, params: { frequency: 375 }, frames: 1024 });
      left.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 4));
    });
  });

  describe('unison', () => {
    it('detunes the voices evenly from -spread/2 to +spread/2, the middle one of an odd count both', () => {
      const { store } = core.storeWith({ a: [sine] });
      // an octave below and above the note and the note itself: voice 0 right, the middle one both,
      // 2 left
      const { left, right } = render({
        store,
        oscs: [osc({ unison: 3 })],
        params: { frequency: 400, spread1: 2400 },
        frames: RATE,
      });
      const level = 1 / Math.sqrt(2);
      expect(toneAmplitude(right, 200)).toBeCloseTo(level, 2);
      expect(toneAmplitude(right, 400)).toBeCloseTo(level, 2);
      expect(toneAmplitude(right, 800)).toBeCloseTo(0, 2);
      expect(toneAmplitude(left, 200)).toBeCloseTo(0, 2);
      expect(toneAmplitude(left, 400)).toBeCloseTo(level, 2);
      expect(toneAmplitude(left, 800)).toBeCloseTo(level, 2);
    });

    it.each([3, 5, 7])(
      'puts the voices of u%s around the middle one: the channels mirror each other',
      (unison) => {
        const { store } = core.storeWith({ a: [sine] });
        const spread = 2400;
        const { left, right } = render({
          store,
          oscs: [osc({ unison })],
          params: { frequency: 400, spread1: spread },
          frames: RATE,
        });
        const level = 1 / Math.sqrt(Math.ceil(unison / 2));
        const middle = (unison - 1) / 2;
        const cents = (j: number) => spread * (j / (unison - 1) - 0.5);
        for (let j = 0; j < unison; j++) {
          const pitch = 400 * 2 ** (cents(j) / 1200);
          // the voices below the middle from the right, the ones above it continue the turns
          const side = j > middle ? j - 1 : j;
          const inLeft = j === middle || side % 2 === 1;
          const inRight = j === middle || side % 2 === 0;
          expect(toneAmplitude(left, pitch)).toBeCloseTo(inLeft ? level : 0, 2);
          expect(toneAmplitude(right, pitch)).toBeCloseTo(inRight ? level : 0, 2);
          // its mirror (the same detune, the other way) is on the other side
          const mirror = 400 * 2 ** (-cents(j) / 1200);
          if (j !== middle) expect(toneAmplitude(inLeft ? right : left, mirror)).toBeCloseTo(level, 2);
        }
      }
    );

    it('pairs 8 voices into the channels at the level of 4 per channel', () => {
      const { store } = core.storeWith({ a: [sine] });
      const { left, right } = render({
        store,
        oscs: [osc({ unison: 8 })],
        params: { frequency: 400, spread1: 1400 },
        frames: RATE,
      });
      // voice j at 400 · 2^((j / 7 - 1/2) · 1400 / 1200)
      const pitch = (j: number) => 400 * 2 ** (((j / 7 - 0.5) * 1400) / 1200);
      for (let j = 0; j < 8; j++) {
        const [own, other] = j % 2 === 0 ? [right, left] : [left, right];
        expect(toneAmplitude(own, pitch(j))).toBeCloseTo(0.5, 2);
        expect(toneAmplitude(other, pitch(j))).toBeCloseTo(0, 2);
      }
    });

    it('plays one voice at detune 0', () => {
      const { store } = core.storeWith({ a: [saw] });
      const unison = render({ store, oscs: [osc({ unison: 8 })], frames: 4096 });
      const single = render({ store, oscs: [osc({ unison: 1 })], frames: 4096 });
      expect(unison.left).toEqual(single.left);
      expect(unison.right).toEqual(single.left);
    });

    // the start of a note over many notes: at Phase rand 1 the voices start at random phases and add up to
    // the power of one voice
    it.each([2, 3, 8])('keeps the level of u%s at that of one voice at Phase rand 1', (unison) => {
      const { store } = core.storeWith({ a: [saw] });
      const frames = 0.1 * RATE;
      const measure = (voices: number) => {
        let power = 0;
        let peak = 0;
        const notes = 400;
        for (let seed = 1; seed <= notes; seed++) {
          const { left, right } = render({
            store,
            oscs: [osc({ unison: voices, phaseRand: 1 })],
            params: { frequency: 220, spread1: 5 },
            frames,
            random: seeded(seed),
          });
          power += (rms(left) ** 2 + rms(right) ** 2) / 2;
          peak += Math.max(...left.map(Math.abs), ...right.map(Math.abs));
        }
        return { rms: Math.sqrt(power / notes), peak: peak / notes };
      };
      const one = measure(1);
      const many = measure(unison);
      expect(Math.abs(db(many.rms / one.rms))).toBeLessThan(0.3);
      expect(db(many.peak / one.peak)).toBeGreaterThan(-1);
      expect(db(many.peak / one.peak)).toBeLessThan(4);
    });

    it('gives a channel 1/√ceil(n/2) per voice', () => {
      const { store } = core.storeWith({ a: [sine] });
      for (const [unison, level] of [
        [1, 1],
        [2, 1],
        [3, 1 / Math.sqrt(2)],
        [8, 0.5],
      ]) {
        // far apart: no beats between the voices
        // (the lowest voice on the right)
        const { right } = render({
          store,
          oscs: [osc({ unison })],
          params: { frequency: 300, spread1: 4800 },
          frames: RATE,
        });
        expect(toneAmplitude(right, unison === 1 ? 300 : 300 * 2 ** -2)).toBeCloseTo(level, 2);
      }
    });
  });

  describe('unison shape', () => {
    const shaped = (unison: number, shape: Partial<UnisonShape>, config: Partial<VoiceOscOptions> = {}) =>
      osc({ unison, unisonShape: { ...UNISON_SHAPE, ...shape }, ...config });
    // the amplitude of each voice in each channel: [pitch, left, right]
    const expectVoices = (
      { left, right }: { left: Float32Array; right: Float32Array },
      voices: [number, number, number][]
    ) =>
      voices.forEach(([pitch, inLeft, inRight]) => {
        expect(toneAmplitude(left, pitch)).toBeCloseTo(inLeft, 2);
        expect(toneAmplitude(right, pitch)).toBeCloseTo(inRight, 2);
      });

    describe('blend', () => {
      // u5 an octave below to an octave above: 200 right, 283 left, 400 both (the centre), 566 right, 800 left
      const u5 = (blend: number) => {
        const { store } = core.storeWith({ a: [sine] });
        return render({
          store,
          oscs: [shaped(5, { blend })],
          params: { frequency: 400, spread1: 2400 },
          frames: RATE,
        });
      };
      const pitch = (cents: number) => 400 * 2 ** (cents / 1200);

      it.each([
        // the centre and the others at 1/√3 × their gain: c = min(1, 2(1 - b)), s = min(1, 2b), × √(3 / (c² + 2s²))
        [0, 1, 0],
        [0.25, Math.sqrt(2 / 3), Math.sqrt(1 / 6)],
        [0.5, 1 / Math.sqrt(3), 1 / Math.sqrt(3)],
        [0.75, 1 / 3, 2 / 3],
        [1, 0, 1 / Math.sqrt(2)],
      ])(
        'at %s plays the centre and the others at their gains, the power of one voice',
        (blend, center, side) => {
          const out = u5(blend);
          expectVoices(out, [
            [pitch(-1200), 0, side],
            [pitch(-600), side, 0],
            [pitch(0), center, center],
            [pitch(600), 0, side],
            [pitch(1200), side, 0],
          ]);
          expect(center ** 2 + 2 * side ** 2).toBeCloseTo(1, 6);
        }
      );

      it('has the middle two voices of an even count as its centre', () => {
        const { store } = core.storeWith({ a: [sine] });
        // u4: 200 right, 317 left (the centre), 504 right (the centre), 800 left, at 1/√2 × their gain
        const out = render({
          store,
          oscs: [shaped(4, { blend: 0 })],
          params: { frequency: 400, spread1: 2400 },
          frames: RATE,
        });
        expectVoices(out, [
          [pitch(-1200), 0, 0],
          [pitch(-400), 1, 0],
          [pitch(400), 0, 1],
          [pitch(1200), 0, 0],
        ]);
      });

      it('changes nothing in a unison of 2: it is all centre', () => {
        const { store } = core.storeWith({ a: [saw] });
        const play = (blend: number) =>
          render({ store, oscs: [shaped(2, { blend })], params: { spread1: 20 }, frames: 2048 });
        expect(play(0).left).toEqual(play(0.5).left);
        expect(play(1).right).toEqual(play(0.5).right);
      });
    });

    describe('width', () => {
      // u3: 200 right, 400 both, 800 left at 1/√2
      const u3 = (width: number) => {
        const { store } = core.storeWith({ a: [sine] });
        return render({
          store,
          oscs: [shaped(3, { width })],
          params: { frequency: 400, spread1: 2400 },
          frames: RATE,
        });
      };

      it('pans the side voices to the middle at equal power, the centre stays', () => {
        const level = 1 / Math.sqrt(2);
        const [own, other] = [Math.cos(Math.PI / 8) * level, Math.sin(Math.PI / 8) * level];
        expectVoices(u3(0.5), [
          [200, other, own],
          [400, level, level],
          [800, own, other],
        ]);
        expectVoices(u3(0), [
          [200, 0.5, 0.5],
          [400, level, level],
          [800, 0.5, 0.5],
        ]);
      });

      it('is mono at 0: both channels the same', () => {
        const { left, right } = u3(0);
        left.forEach((value, i) => expect(value).toBeCloseTo(right[i], 6));
      });
    });

    // the voices as measured (scripts/renders/run.mjs --only=unison-modes): the peaks of a sine
    // at C4 over 2^18 samples (Hann), their cents refined by the parabola of their bins, the side of each
    const C4 = 440 * 2 ** ((60 - 69) / 12);
    const PEAKS = 1 << 18;
    const peaksOf = (
      { left, right }: { left: Float32Array; right: Float32Array },
      low: number,
      high: number
    ) => {
      const spectrum = (x: Float32Array) => {
        const fft = new FFT(PEAKS);
        const bins = fft.createComplexArray();
        fft.realTransform(
          bins,
          Array.from(
            { length: PEAKS },
            (_, i) => x[i + 9600] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / PEAKS))
          )
        );
        return Float64Array.from({ length: PEAKS / 2 }, (_, k) => Math.hypot(bins[2 * k], bins[2 * k + 1]));
      };
      const [l, r] = [spectrum(left), spectrum(right)];
      const bin = (cents: number) => (C4 * 2 ** (cents / 1200) * PEAKS) / RATE;
      const found: { cents: number; side: string }[] = [];
      for (let k = Math.floor(bin(low)) + 1; k < Math.ceil(bin(high)); k++) {
        const [y0, y1, y2] = [l[k - 1] + r[k - 1], l[k] + r[k], l[k + 1] + r[k + 1]];
        if (y1 > y0 && y1 >= y2 && y1 > 0.001 * (PEAKS / 4)) {
          const d = (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2);
          const [a, b] = [Math.hypot(l[k - 1], l[k], l[k + 1]), Math.hypot(r[k - 1], r[k], r[k + 1])];
          found.push({
            cents: 1200 * Math.log2(((k + d) * RATE) / PEAKS / C4),
            side: a > 2 * b ? 'L' : b > 2 * a ? 'R' : 'C',
          });
        }
      }
      return found;
    };
    const sineVoices = (unison: number, shape: Partial<UnisonShape>, spread: number) => {
      const { store } = core.storeWith({ a: [sine] });
      return render({
        store,
        oscs: [shaped(unison, shape)],
        params: { frequency: C4, spread1: spread },
        frames: PEAKS + 9600,
      });
    };

    describe('stack', () => {
      const STACKS: Record<string, UnisonStack> = {
        off: 'off',
        '12 (1x)': '12x1',
        '12 (2x)': '12x2',
        '12 (3x)': '12x3',
        '12+7 (1x)': '12+7x1',
        '12+7 (2x)': '12+7x2',
        '12+7 (3x)': '12+7x3',
        'Center-12': 'center-12',
        'Center-24': 'center-24',
      };
      const STEPS = [-24, -12, 0, 7, 12, 19, 24, 31, 36];
      // measured at Detune 0.5 (the voices at ±35 cents), up to the 8 voices of ours
      const cases = Object.entries(MEASURED_UNISON.stacks).filter(([key]) => Number(key.split(' u')[1]) <= 8);

      it.each(cases)('moves the voices as measured: %s', (key, measured) => {
        const [name, n] = key.split(' u');
        const voices = peaksOf(sineVoices(Number(n), { stack: STACKS[name] }, 70), -2500, 4000)
          .map(({ cents, side }) => {
            const step = STEPS.reduce((a, b) =>
              Math.abs(cents / 100 - b) < Math.abs(cents / 100 - a) ? b : a
            );
            return { step, detune: Math.round(cents - 100 * step), side };
          })
          .sort((a, b) => a.detune - b.detune);
        expect(voices.map(({ step }) => step)).toEqual(measured.map(({ step }) => step));
        voices.forEach(({ detune }, j) =>
          expect(Math.abs(detune - measured[j].detune)).toBeLessThanOrEqual(7)
        );
        // (two centre voices close together show as one peak on both sides)
        voices.forEach(
          ({ side }, j) => measured[j].side !== 'C' && side !== 'C' && expect(side).toBe(measured[j].side)
        );
      });
    });

    describe('detune', () => {
      // measured at Detune 1 (the outer voices at ±200 cents), up to the 8 voices of ours
      const cases = Object.entries(MEASURED_UNISON.modes).filter(([key]) => Number(key.split(' u')[1]) <= 8);

      it.each(cases)('shares the spread as measured: %s', (key, measured) => {
        const [mode, n] = key.split(' u');
        const cents = peaksOf(
          sineVoices(Number(n), { detune: mode as UnisonShape['detune'] }, 400),
          -300,
          300
        ).map((peak) => peak.cents);
        expect(cents).toHaveLength(measured.length);
        // (the measured voices 0.05 cents above ours: their note, ours at 440 · 2^(-9/12) exactly)
        cents.forEach((c, j) => expect(Math.abs(c - measured[j])).toBeLessThan(0.3));
      });

      it('detunes the voices at random shares of the spread, sorted from the lowest, drawn after the phases', () => {
        const { store } = core.storeWith({ a: [sine] });
        const out = render({
          store,
          oscs: [shaped(4, { detune: 'random' })],
          params: { frequency: 400, spread1: 1200 },
          frames: RATE,
          random: seeded(3),
        });
        const random = seeded(3);
        Array.from({ length: 8 }, random);
        const shares = Array.from({ length: 4 }, random).sort((a, b) => a - b);
        // even: from the lowest right, left, right, left at 1/√2
        expectVoices(
          out,
          shares.map((share, j): [number, number, number] => {
            const level = 1 / Math.sqrt(2);
            return [400 * 2 ** (share - 0.5), j % 2 === 1 ? level : 0, j % 2 === 0 ? level : 0];
          })
        );
      });

      it('draws 8 shares more per oscillator only for a random detune', () => {
        const { store } = core.storeWith({ a: [saw] });
        const calls = (detune: UnisonShape['detune']) => {
          let count = 0;
          const random = () => (count++ % 10) / 10;
          render({ store, oscs: [shaped(8, { detune }), null], frames: 0, random });
          return count;
        };
        expect(calls('linear')).toBe(8);
        expect(calls('random')).toBe(16);
      });
    });

    describe('position spread', () => {
      // frame 0 the fundamental, 1 the 2nd harmonic, 2 the 3rd
      const table = [cycle(2048, [[1, 1]]), cycle(2048, [[2, 1]]), cycle(2048, [[3, 1]])];

      it('plays the positions of the voices spread as their pitch, within the table', () => {
        const { store } = core.storeWith({ a: table });
        // u3 at frame 1 and a spread of the whole table: voice 0 (right) frame 0, the middle one 1, voice 2 (left)
        // frame 2; at frame 2 voice 2 stays on the last frame
        const level = 1 / Math.sqrt(2);
        const at = (position: number) =>
          render({
            store,
            oscs: [shaped(3, { positionSpread: 1 })],
            params: { frequency: 400, position1: position },
            frames: RATE,
          });
        expectVoices(at(0.5), [
          [400, 0, level],
          [800, level, level],
          [1200, level, 0],
        ]);
        expectVoices(at(1), [
          [400, 0, 0],
          [800, 0, level],
          [1200, 2 * level, level],
        ]);
      });

      it('spreads a moving position the same way', () => {
        const { store } = core.storeWith({ a: table });
        const play = (position1: ParamValue) =>
          render({
            store,
            oscs: [shaped(3, { positionSpread: 0.5 })],
            params: { frequency: 400, position1 },
            frames: 4096,
          });
        // (moving by less than a float32 step of 0.5 in a few samples: every block is played as moving)
        const moving = play((frame) => 0.5 + (frame % 2) * 6e-8);
        const still = play(0.5);
        moving.left.forEach((value, i) => expect(value).toBeCloseTo(still.left[i], 4));
        moving.right.forEach((value, i) => expect(value).toBeCloseTo(still.right[i], 4));
      });
    });
  });

  describe('phase', () => {
    it.each([
      // voice 1, the middle of 3, plays in both channels: 2 voices at 1/√2 each
      [2, 1],
      [3, Math.SQRT2],
      // 4 voices at 1/2 a channel
      [8, 2],
    ])('starts all u%s voices at the phase at Phase rand 0, without a fade', (unison, peak) => {
      const { store } = core.storeWith({ a: [sine] });
      const { left, right } = render({
        store,
        oscs: [osc({ unison, phase: 0.25 })],
        params: { spread1: 0.001 },
        frames: 256,
      });
      expect(left[0]).toBeCloseTo(peak, 4);
      expect(right[0]).toBeCloseTo(peak, 4);
    });

    it('shifts each voice by a random share of its own, fading in', () => {
      const { store } = core.storeWith({ a: [sine] });
      // voices 0 and 2 at the phase, voice 1 (the middle: both channels, at 1/√2 as the others) half a
      // period off
      const shares = [0, 0.5, 0];
      const { left, right } = render({
        store,
        oscs: [osc({ unison: 3, phase: 0.25, phaseRand: 1 })],
        params: { spread1: 0.001 },
        frames: 4096,
        random: () => shares.shift() ?? 0,
      });
      expect(left[0]).toBe(0);
      expect(right[0]).toBe(0);
      // after the fade voice 1 cancels voice 0 on the left and voice 2 on the right
      expect(Math.max(...left.subarray(1000).map(Math.abs))).toBeLessThan(1e-3);
      expect(Math.max(...right.subarray(1000).map(Math.abs))).toBeLessThan(1e-3);
    });

    // a voice at a random phase starts at once (its click on a fast attack is part of the sound)
    it('starts at once at a random phase', () => {
      const { store } = core.storeWith({ a: [sine] });
      const { left } = render({
        store,
        oscs: [osc({ phase: 0.25, phaseRand: 1e-9 })],
        params: { frequency: 10 },
        frames: 256,
      });
      const wave = (i: number) => Math.sin(2 * Math.PI * (0.25 + (10 * i) / RATE));
      expect(left[0]).toBeCloseTo(wave(0), 3);
      expect(left[36]).toBeCloseTo(wave(36), 3);
      expect(left[72]).toBeCloseTo(wave(72), 3);
    });

    it('fades a note of a legato phrase in within 1.5 ms (it would step to the level of the phrase)', () => {
      const { store } = core.storeWith({ a: [sine] });
      // its envelopes started 10 ms before it, at its phase without a random share
      const { left } = render({
        store,
        oscs: [osc({ phase: 0.25, phaseRand: 0 })],
        params: { frequency: 10 },
        frames: 1024,
        start: 512 / RATE,
        envStart: 512 / RATE - 0.01,
        from: 512,
      });
      const wave = (i: number) => Math.sin(2 * Math.PI * (0.25 + (10 * (i - 512)) / RATE));
      expect(left[512]).toBe(0);
      expect(left[548]).toBeCloseTo(0.5 * wave(548), 3);
      expect(left[584]).toBeCloseTo(wave(584), 3);
    });

    it('shifts every voice by a random share of phaseRand, u1 too', () => {
      const { store } = core.storeWith({ a: [sine] });
      // 0.5 · 0.5: a quarter period after the phase
      const { left } = render({
        store,
        oscs: [osc({ phase: 0, phaseRand: 0.5 })],
        params: { frequency: 10 },
        frames: 256,
        random: () => 0.5,
      });
      expect(left[200]).toBeCloseTo(Math.sin(2 * Math.PI * (0.25 + (10 * 200) / RATE)), 3);
    });

    it('draws the random shares only at the note on', () => {
      const { store } = core.storeWith({ a: [sine] });
      const random = jest.fn(seeded(3));
      const { dsp } = render({ store, oscs: [osc({ unison: 8, phaseRand: 1 })], frames: 0, random });
      const calls = random.mock.calls.length;
      const outL = new Float32Array(BLOCK);
      const params = Object.fromEntries(
        Object.entries(DEFAULTS).map(([name, value]) => [name, Float32Array.of(value)])
      ) as Record<VoiceParam, Float32Array>;
      for (let frame = 0; frame < 4096; frame += BLOCK)
        dsp.process(frame, params, outL, new Float32Array(BLOCK));
      expect(random).toHaveBeenCalledTimes(calls);
    });
  });

  describe('lifecycle', () => {
    it('starts exactly at the start time', () => {
      const { store } = core.storeWith({ a: [sine] });
      const { left } = render({ store, oscs: [osc({ phase: 0.25 })], start: 300.5 / RATE, frames: 512 });
      expect(left.subarray(0, 301).every((value) => value === 0)).toBe(true);
      expect(left[301]).toBeCloseTo(1, 4);
    });

    it('stops exactly where the gate drops to 0 without a release and ends', () => {
      const { store } = core.storeWith({ a: [sine] });
      const { left, endedAt, dsp } = render({
        store,
        oscs: [osc({ phase: 0.25 })],
        params: { frequency: 10, gate: gateAt(300) },
        frames: 1024,
      });
      expect(left[299]).not.toBe(0);
      expect(left.subarray(300).every((value) => value === 0)).toBe(true);
      expect(endedAt).toBe(256);
      expect(dsp.ended).toBe(true);
    });

    it('fades a stolen voice out in 20 ms (a raised cosine) from where the gate drops below 0', () => {
      const { store } = core.storeWith({ a: [sine] });
      const { left, endedAt } = render({
        store,
        oscs: [osc({ phase: 0.25 })],
        params: { frequency: 10, gate: gateAt(256, -1) },
        frames: 2048,
      });
      const wave = (frame: number) => Math.cos((2 * Math.PI * 10 * frame) / RATE);
      expect(left[255]).toBeCloseTo(wave(255), 4);
      // a quarter, a half and three quarters of the fade
      [240, 480, 720].forEach((x) =>
        expect(left[256 + x]).toBeCloseTo((0.5 + 0.5 * Math.cos((Math.PI * x) / 960)) * wave(256 + x), 3)
      );
      expect(left.subarray(256 + 960).every((value) => value === 0)).toBe(true);
      expect(endedAt).toBe(1152);
    });

    // a sine of period 512 stolen at its peak (the worst case: a cut there steps from 1), through a Hann window
    // of 4096 centred on the steal: the energy above 4 · f0 against a cut at the same sample
    it('fades a stolen voice out with a splatter at least 50 dB below a cut', () => {
      const { store } = core.storeWith({ a: [sine] });
      const steal = 4096;
      const size = 4096;
      const { left } = render({
        store,
        oscs: [osc({ phase: 0.25 })],
        params: { frequency: RATE / 512, gate: gateAt(steal, -1) },
        frames: 8192,
      });
      const splatter = (signal: Float32Array) => {
        const fft = new FFT(size);
        const out = fft.createComplexArray();
        const from = steal - size / 2;
        const windowed = Array.from(
          { length: size },
          (_, i) => signal[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size))
        );
        fft.realTransform(out, windowed);
        let sum = 0;
        for (let k = (4 * size) / 512; k < size / 2; k++) sum += out[2 * k] ** 2 + out[2 * k + 1] ** 2;
        return sum;
      };
      const cut = left.map((value, i) => (i < steal ? value : 0));
      expect(left[steal - 1]).toBeCloseTo(1, 3);
      expect(10 * Math.log10(splatter(left) / splatter(cut))).toBeLessThan(-50);
    });

    it('frees its versions when it ends', () => {
      const { store, freed } = core.storeWith({ a: [sine] });
      const entry = store.latest('a');
      render({ store, frames: 512, params: { gate: gateAt(100) } });
      store.set('a', 2, buildLevels([square]));
      expect(freed).toEqual([entry?.levels]);
    });

    it('stays silent and ends at a gate closed before its start', () => {
      const { store } = core.storeWith({ a: [sine] });
      const { left, endedAt } = render({
        store,
        start: 500 / RATE,
        frames: 1024,
        params: { gate: gateAt(100) },
      });
      expect(left.every((value) => value === 0)).toBe(true);
      expect(endedAt).toBe(384);
    });
  });

  describe('ENV 1', () => {
    const env: EnvelopeParams = { attack: 0.01, hold: 0.005, decay: 0.02, sustain: 0.5, release: 0.03 };
    // a constant level: a table of 1 (the DC and the nyquist are dropped from a frame, so a square at 1/2 the
    // rate can't be used): the voice of a sine at its peak, slower than the envelope
    const peak = (frames: number, options: Partial<RenderOptions> = {}) => {
      const { store } = core.storeWith({ a: [sine] });
      return render({ store, oscs: [osc({ phase: 0.25 })], params: { frequency: 0.01 }, frames, ...options });
    };
    const sec = (frame: number) => frame / RATE;

    it('shapes the note: attack, hold, decay and sustain, exact to the sample', () => {
      const { left, right } = peak(4096, { envelope: env });
      for (let i = 0; i < 4096; i += 7) {
        expect(left[i]).toBeCloseTo(envelopeValue(env, sec(i)), 4);
        expect(right[i]).toBeCloseTo(left[i], 6);
      }
      expect(left[0]).toBe(0);
      expect(left[480]).toBeCloseTo(1, 4);
      expect(left[3000]).toBeCloseTo(0.5, 4);
    });

    // the decay and the release curved (the default shape); the release still ends where a linear one does
    it('curves the decay and the release', () => {
      const curved = withCurves(env);
      // (its end within a block)
      const release = 2300;
      const { left, endedAt } = peak(8192, {
        envelope: curved,
        params: { frequency: 0.01, gate: gateAt(release) },
      });
      for (let i = 0; i < 8192; i += 5)
        expect(left[i]).toBeCloseTo(envelopeValue(curved, sec(i), sec(release)), 4);
      // in the decay: below the line
      expect(left[960]).toBeLessThan(envelopeValue(env, sec(960)) - 0.05);
      expect(endedAt).toBe(Math.floor((release + 0.03 * RATE) / BLOCK) * BLOCK);
    });

    it('releases from the level reached, in the attack and in the decay, and ends exactly at its end', () => {
      // released at frame 240 (half the attack: 0.5) and 1200 (in the decay: 0.875)
      [240, 1200].forEach((release) => {
        const { left, endedAt } = peak(8192, {
          envelope: env,
          params: { frequency: 0.01, gate: gateAt(release) },
        });
        const end = release + 0.03 * RATE;
        for (let i = 0; i < 8192; i += 5)
          expect(left[i]).toBeCloseTo(envelopeValue(env, sec(i), sec(release)), 4);
        expect(left[end - 1]).toBeGreaterThan(0);
        expect(left.subarray(end).every((value) => value === 0)).toBe(true);
        expect(endedAt).toBe(Math.floor(end / BLOCK) * BLOCK);
      });
    });

    it('releases from the sustain', () => {
      const { left, endedAt } = peak(8192, {
        envelope: env,
        params: { frequency: 0.01, gate: gateAt(4000) },
      });
      expect(left[3999]).toBeCloseTo(0.5, 4);
      expect(left[4000 + 720]).toBeCloseTo(0.25, 3);
      expect(left[5440]).toBe(0);
      expect(endedAt).toBe(5376);
    });

    it('ends at once when released at 0', () => {
      const silent = { ...env, sustain: 0, release: 1 };
      const { endedAt } = peak(8192, { envelope: silent, params: { frequency: 0.01, gate: gateAt(4000) } });
      expect(endedAt).toBe(3968);
    });

    it('does not start again in legato: it goes on from the start of the phrase, fading in', () => {
      // the phrase started 0.01 s before the note: at its first sample the envelope is at the end of the attack,
      // the note fades in over 1.5 ms (72 samples) instead of stepping to that level
      const start = 1000;
      const { left } = peak(4096, { envelope: env, start: sec(start), envStart: sec(start) - 0.01 });
      expect(left.subarray(0, start + 1).every((value) => value === 0)).toBe(true);
      expect(left[start + 36]).toBeCloseTo(0.5, 4);
      expect(left[start + 72]).toBeCloseTo(1, 4);
      expect(left[start + 960]).toBeCloseTo(envelopeValue(env, 0.01 + sec(960)), 4);
    });

    it('processed after its start, starts its envelopes at its first sample, in legato goes on from the phrase', () => {
      // scheduled at 100, its first block at 1280 (its node came a device buffer late): the attack is played
      const { left } = peak(4096, { envelope: env, start: sec(100), from: 1280 });
      for (let i = 1280; i < 4096; i += 7) expect(left[i]).toBeCloseTo(envelopeValue(env, sec(i - 1280)), 4);
      expect(left[1280]).toBe(0);
      expect(left[1280 + 480]).toBeCloseTo(1, 4);
      // released after its first block: at that sample, from the level reached since its first sample
      const released = peak(8192, {
        envelope: env,
        start: sec(100),
        from: 1280,
        params: { frequency: 0.01, gate: gateAt(1280 + 240) },
      });
      expect(released.left[1280 + 240]).toBeCloseTo(0.5, 4);
      expect(released.endedAt).toBe(Math.floor((1280 + 240 + 0.03 * RATE) / BLOCK) * BLOCK);
      // a note of a phrase started 0.01 s before it (its first voice unknown): the level of the phrase once it
      // has faded in
      const legato = peak(4096, { envelope: env, start: sec(100), envStart: sec(100) - 0.01, from: 1280 });
      expect(legato.left[1280]).toBe(0);
      expect(legato.left[1280 + 72]).toBeCloseTo(envelopeValue(env, 0.01 + sec(1180 + 72)), 4);
    });

    it('starts the envelopes of a note of a phrase where its first voice, processed late, started them', () => {
      // the first note scheduled at 100 is processed from 1280, the second one of the phrase from 2048: it is in
      // the decay of the phrase started at 1280 (in its sustain from 100)
      const shared = core.createVoiceShared();
      peak(4096, { envelope: env, start: sec(100), from: 1280, shared });
      const { left } = peak(4096, {
        envelope: env,
        start: sec(2000),
        envStart: sec(100),
        from: 2048,
        shared,
      });
      for (let i = 2048 + 72; i < 4096; i += 7)
        expect(left[i]).toBeCloseTo(envelopeValue(env, sec(i - 1280)), 4);
      expect(left[2048 + 72]).toBeGreaterThan(0.9);
    });

    it('starts the envelopes of a note of a phrase where its first voice will, processed after it in a block', () => {
      // both are processed from 1280 on, the second one first: the first voice starts there in this block
      const shared = core.createVoiceShared();
      const { store } = core.storeWith({ a: [sine] });
      const first = core.createVoiceDsp(
        RATE,
        {
          osc: [osc()],
          start: sec(100),
          envelopes: [env, FLAT, FLAT],
          envStart: sec(100),
          phrase: 0,
          routes: [],
          filter: null,
        },
        store,
        seeded(1),
        shared
      );
      const { left } = peak(4096, {
        envelope: env,
        start: sec(1200),
        envStart: sec(100),
        from: 1280,
        shared,
      });
      for (let i = 1280 + 72; i < 4096; i += 7)
        expect(left[i]).toBeCloseTo(envelopeValue(env, sec(i - 1280)), 4);
      expect(first.startedAt).toBe(-1);
    });

    it('keeps the phrase of a held note when a note out of legato starts its own meanwhile', () => {
      // the first note scheduled at 100 is processed from 1280; legato off, a note starts its envelopes at
      // 1536; legato on again, a note of the first phrase from 2048: in the decay of the phrase started at 1280
      const shared = core.createVoiceShared();
      peak(4096, { envelope: env, start: sec(100), from: 1280, shared });
      peak(4096, { envelope: env, start: sec(1536), from: 1536, phrase: 1, shared });
      const { left } = peak(4096, {
        envelope: env,
        start: sec(2000),
        envStart: sec(100),
        from: 2048,
        shared,
      });
      for (let i = 2048 + 72; i < 4096; i += 7)
        expect(left[i]).toBeCloseTo(envelopeValue(env, sec(i - 1280)), 4);
      expect(left[2048 + 72]).toBeGreaterThan(0.9);
    });

    it('keeps two phrases scheduled at the same frame apart', () => {
      // a key released and the next one pressed within a device buffer: both phrases are scheduled at 100, the
      // first one processed from 1280 (still playing), the next one from 1792; a note of the next one from 2048
      // goes on from 1792 (in its attack), not from the first one
      const shared = core.createVoiceShared();
      peak(4096, { envelope: env, start: sec(100), from: 1280, shared });
      peak(4096, { envelope: env, start: sec(100), from: 1792, phrase: 1, shared });
      const { left } = peak(4096, {
        envelope: env,
        start: sec(2000),
        envStart: sec(100),
        from: 2048,
        phrase: 1,
        shared,
      });
      for (let i = 2048 + 72; i < 4096; i += 7)
        expect(left[i]).toBeCloseTo(envelopeValue(env, sec(i - 1792)), 4);
      expect(left[2048 + 72]).toBeLessThan(0.7);
    });

    it('forgets a phrase once its voices have ended: a note of it goes on from its start', () => {
      // the only voice of the phrase, processed from 1280, released at 1400, has ended (a release of 1 ms)
      const short = { ...env, release: 0.001 };
      const shared = core.createVoiceShared();
      const first = peak(4096, {
        envelope: short,
        start: sec(100),
        from: 1280,
        params: { frequency: 0.01, gate: gateAt(1400) },
        shared,
      });
      expect(first.endedAt).toBe(1408);
      const { left } = peak(4096, {
        envelope: short,
        start: sec(1536),
        envStart: sec(100),
        from: 1536,
        shared,
      });
      for (let i = 1536 + 72; i < 4096; i += 7)
        expect(left[i]).toBeCloseTo(envelopeValue(short, sec(i - 100)), 4);
    });

    it('processed after its start, releases as long after its first sample as its key was held, wherever it is seen', () => {
      // scheduled at 100, its first block at 1280: the gate seen with its node, in a later block before the
      // release (1520, held 1420 frames: at 2700), after it (at the sample it is seen), held over a stalled clock
      // (at most 50 ms after it is seen)
      [
        [1280, sec(200), 200],
        [1520, sec(1420), 1420],
        [3000, sec(100), 1720],
        [2000, 10, 720 + 2400],
      ].forEach(([seen, hold, held]) => {
        const { left, endedAt } = peak(8192, {
          envelope: env,
          start: sec(100),
          from: 1280,
          params: { frequency: 0.01, gate: gateAt(seen, RELEASE_GATE + hold) },
        });
        for (let i = 1280; i < 8192; i += 5)
          expect(left[i]).toBeCloseTo(envelopeValue(env, sec(i - 1280), sec(held)), 4);
        expect(endedAt).toBe(Math.floor((1280 + held + 0.03 * RATE) / BLOCK) * BLOCK);
      });
    });

    it('fades a stolen voice out in 20 ms from the level it has', () => {
      const { left, endedAt } = peak(8192, {
        envelope: env,
        params: { frequency: 0.01, gate: gateAt(3000, -1) },
      });
      expect(left[2999]).toBeCloseTo(0.5, 4);
      expect(left[3000 + 480]).toBeCloseTo(0.25, 3);
      expect(left.subarray(3960).every((value) => value === 0)).toBe(true);
      expect(endedAt).toBe(3840);
    });

    it('fades out a voice stolen in its release: the fade on the release, over before its end', () => {
      const gate = (frame: number) => (frame < 3000 ? 1 : frame < 3100 ? 0 : -1);
      const { left, endedAt } = peak(8192, { envelope: env, params: { frequency: 0.01, gate } });
      expect(left[3099]).toBeCloseTo(0.5 * (1 - 99 / 1440), 3);
      expect(left[3100 + 480]).toBeCloseTo(0.5 * 0.5 * (1 - 580 / 1440), 3);
      // the release would end at 4440
      expect(left.subarray(4060).every((value) => value === 0)).toBe(true);
      expect(endedAt).toBe(3968);
    });
  });

  describe('started again (mono: a note on a voice that sounds)', () => {
    const env: EnvelopeParams = { attack: 0.01, hold: 0.005, decay: 0.02, sustain: 0.5, release: 0.03 };
    // the volume: a sine at its peak, slower than the envelope
    const peak = (frames: number, options: Partial<RenderOptions> = {}) => {
      const { store } = core.storeWith({ a: [sine] });
      return render({ store, oscs: [osc({ phase: 0.25 })], params: { frequency: 0.01 }, frames, ...options });
    };
    const sec = (frame: number) => frame / RATE;
    // the gate held at 1, at `values[k]` from `frames[k]` on
    const gateSteps =
      (frames: number[], values: number[]) =>
      (frame: number): number => {
        let value = 1;
        frames.forEach((from, k) => {
          if (frame >= from) value = values[k];
        });
        return value;
      };

    it('starts its envelopes again where the held gate changes, from the level reached: exact to the sample', () => {
      // in a block (1200), on its first sample (1280), twice within one block (1000 and 1010)
      [[1200], [1280], [1000, 1010]].forEach((starts) => {
        const { left, endedAt } = peak(4096, {
          envelope: env,
          params: { frequency: 0.01, gate: gateSteps(starts, [1.5, 1]) },
        });
        // the envelope a sample is on: the last start before it, from the level the one before had there
        let level = (frame: number) => envelopeValue(env, sec(frame));
        const levels = [level];
        starts.forEach((at) => {
          const before = level;
          const from = before(at);
          level = (frame: number) =>
            frame < at ? before(frame) : envelopeValue(env, sec(frame - at), Infinity, from);
          levels.push(level);
        });
        for (let i = 0; i < 4096; i++) expect(left[i]).toBeCloseTo(level(i), 4);
        expect(endedAt).toBe(-1);
      });
    });

    it('goes on without a step: its steps no larger than those of an attack from 0', () => {
      const plain = peak(4096, { envelope: env });
      const { left } = peak(4096, {
        envelope: env,
        params: { frequency: 0.01, gate: gateSteps([1200], [1.5]) },
      });
      // in the decay at 0.75: up to 1 in the attack's 10 ms
      expect(left[1199]).toBeCloseTo(envelopeValue(env, sec(1199)), 4);
      expect(left[1200]).toBeCloseTo(0.75, 4);
      expect(maxStep(left)).toBeLessThanOrEqual(maxStep(plain.left) + 1e-6);
    });

    it('held again after its release: the release is off, its envelopes start again from the level of the release', () => {
      // released at 2000 (on the sustain, 0.5), held again at 2600, at 1: the value of its note on
      const { left, endedAt } = peak(8192, {
        envelope: env,
        params: { frequency: 0.01, gate: gateSteps([2000, 2600], [RELEASE_GATE, 1]) },
      });
      const from = envelopeValue(env, sec(2600), sec(2000));
      expect(from).toBeCloseTo(0.5 * (1 - 600 / 1440), 6);
      for (let i = 2600; i < 8192; i += 3)
        expect(left[i]).toBeCloseTo(envelopeValue(env, sec(i - 2600), Infinity, from), 4);
      expect(left[8191]).toBeCloseTo(0.5, 4);
      expect(endedAt).toBe(-1);
    });

    it('releases as long after its last start again as its key was held', () => {
      // started again at 1000, released at 3000 held 2400 frames: at 3400 (from the note on: at 3000)
      const { left, endedAt } = peak(8192, {
        envelope: env,
        params: { frequency: 0.01, gate: gateSteps([1000, 3000], [1.5, RELEASE_GATE + sec(2400)]) },
      });
      const from = envelopeValue(env, sec(1000));
      for (let i = 1000; i < 8192; i += 3)
        expect(left[i]).toBeCloseTo(envelopeValue(env, sec(i - 1000), sec(2400), from), 4);
      expect(endedAt).toBe(Math.floor((3400 + 1440) / BLOCK) * BLOCK);
    });

    it('moves the routes on from the levels of their envelopes, without a step', () => {
      // ENV 2 lowers the gain: up in 5 ms, down to 0.2 in 20 ms; started again on a point the routes are worked
      // out at (every 32 samples, linear in between: exact there)
      const env2: EnvelopeParams = { attack: 0.005, hold: 0, decay: 0.02, sustain: 0.2, release: 0 };
      const routes: VoiceRoute[] = [{ env: 1, param: 'gain1', amount: -0.5, min: 0, max: 1 }];
      const plain = peak(4096, { envelopes: [env2, FLAT], routes });
      const { left } = peak(4096, {
        envelopes: [env2, FLAT],
        routes,
        params: { frequency: 0.01, gate: gateSteps([2016], [1.5]) },
      });
      const from = envelopeValue(env2, sec(2016));
      for (let i = 2016; i < 4096; i += 32)
        expect(left[i]).toBeCloseTo(1 - 0.5 * envelopeValue(env2, sec(i - 2016), Infinity, from), 4);
      expect(maxStep(left)).toBeLessThanOrEqual(maxStep(plain.left) + 1e-6);
    });

    it('is not started again once stolen, nor after its end', () => {
      // stolen at 1000, held again at 1100: the fade goes on to its end
      const stolen = peak(4096, {
        envelope: env,
        params: { frequency: 0.01, gate: gateSteps([1000, 1100], [-1, 1.5]) },
      });
      expect(stolen.left.subarray(1960).every((value) => value === 0)).toBe(true);
      expect(stolen.endedAt).toBe(1920);
      // released at 1000, over at 2440, held again at 2450 (in the block it ends in)
      const over = peak(4096, {
        envelope: env,
        params: { frequency: 0.01, gate: gateSteps([1000, 2450], [0, 1.5]) },
      });
      expect(over.left.subarray(2440).every((value) => value === 0)).toBe(true);
      expect(over.endedAt).toBe(2432);
    });
  });

  describe('modulation', () => {
    // ENV 2: from 1 down to its sustain in 20 ms
    const decay = (sustain: number): EnvelopeParams => ({
      attack: 0,
      hold: 0,
      decay: 0.02,
      sustain,
      release: 0,
    });
    const level = (env: EnvelopeParams, frame: number) => envelopeValue(env, frame / RATE);
    const route = (param: VoiceParam, amount: number, min = 0, max = 1, env = 1): VoiceRoute => ({
      env,
      param,
      amount,
      min,
      max,
    });
    // a sine at its peak, slower than the envelope: the output is the gain
    const peak = (frames: number, options: Partial<RenderOptions> = {}) => {
      const { store } = core.storeWith({ a: [sine] });
      return render({ store, oscs: [osc({ phase: 0.25 })], params: { frequency: 0.01 }, frames, ...options });
    };

    // Firefox gives a param without automation as 128 equal values, Chromium and WebKit as one
    it('plays params of 128 equal values as one, routes on their sustain too: the same bits', () => {
      const { store } = core.storeWith({ a: [saw, square, sine] });
      const values: Params = { frequency: 220, position1: 0.3, spread1: 20, gain1: 0.6, gate: 1 };
      const play = (params: Params) =>
        render({
          store,
          oscs: [osc({ unison: 4 })],
          params,
          frames: 8192,
          envelopes: [decay(0.5), FLAT],
          routes: [route('position1', 0.5), route('spread1', 50, 0, 100), route('gain1', -0.05)],
        });
      const one = play(values);
      const equal = play(
        Object.fromEntries(Object.entries(values).map(([name, value]) => [name, () => value as number]))
      );
      expect(equal.left).toEqual(one.left);
      expect(equal.right).toEqual(one.right);
    });

    it('moves the gain by amount × the envelope, sample by sample', () => {
      const env = decay(0);
      const { left } = peak(2048, { envelopes: [env, FLAT], routes: [route('gain1', -1)] });
      for (let i = 0; i < 2048; i += 3) expect(left[i]).toBeCloseTo(1 - level(env, i), 4);
    });

    it('clamps the base and the routes to the range of the knob', () => {
      const up = peak(1024, {
        params: { frequency: 0.01, gain1: 0.8 },
        envelopes: [decay(1), FLAT],
        routes: [route('gain1', 1)],
      });
      expect(up.left[500]).toBeCloseTo(1, 5);
      const down = peak(1024, {
        params: { frequency: 0.01, gain1: 0.3 },
        envelopes: [decay(1), decay(1)],
        routes: [route('gain1', -0.25), route('gain1', -0.25, 0, 1, 2)],
      });
      expect(down.left[500]).toBe(0);
    });

    it('moves the wave as a share of the table, like the knob there', () => {
      const { store } = core.storeWith({ a: [sine, square, saw] });
      const routed = render({
        store,
        envelopes: [decay(0.5), FLAT],
        routes: [route('position1', 1)],
        frames: 4096,
      });
      const knob = render({ store, params: { position1: 0.5 }, frames: 4096 });
      // on the sustain: the middle frame, as the knob there
      for (let i = 2048; i < 4096; i++) expect(routed.left[i]).toBeCloseTo(knob.left[i], 4);
    });

    it('moves the unison detune in cents, a unison at detune 0 is not collapsed with a route raising it', () => {
      const { store } = core.storeWith({ a: [saw] });
      const env = decay(0.5);
      const routed = render({
        store,
        oscs: [osc({ unison: 2 })],
        envelopes: [env, FLAT],
        routes: [route('spread1', 100, 0, 100)],
        frames: 4096,
      });
      // the knob moved the same way
      const knob = render({
        store,
        oscs: [osc({ unison: 2 })],
        params: { spread1: (frame) => 100 * level(env, frame) },
        frames: 4096,
      });
      routed.left.forEach((value, i) => expect(value).toBeCloseTo(knob.left[i], 4));
      // a route lowering it: collapsed into one voice, as without it
      const lowered = render({
        store,
        oscs: [osc({ unison: 2 })],
        envelopes: [env, FLAT],
        routes: [route('spread1', -50, 0, 100)],
        frames: 1024,
      });
      const one = render({ store, oscs: [osc({ unison: 1 })], frames: 1024 });
      lowered.left.forEach((value, i) => expect(value).toBeCloseTo(one.left[i], 4));
    });

    it('glides a changed amount on a playing note in 10 ms, a removed route back to the base', () => {
      const routes = [route('gain1', -1)];
      const { left } = peak(4096, {
        envelopes: [decay(1), FLAT],
        before: (frame, dsp) => {
          if (frame === 1024) dsp.setRoutes(routes);
          if (frame === 2048) dsp.setRoutes([]);
        },
      });
      expect(left[1023]).toBeCloseTo(1, 4);
      expect(left[1024 + 240]).toBeCloseTo(0.5, 2);
      expect(left[1024 + 480]).toBeCloseTo(0, 4);
      expect(left[2047]).toBeCloseTo(0, 4);
      expect(left[2048 + 240]).toBeCloseTo(0.5, 2);
      expect(left[2048 + 480]).toBeCloseTo(1, 4);
      expect(maxStep(left)).toBeLessThan(0.003);
    });

    describe('the velocity', () => {
      const VELO = 3;

      it('at an amp of 1 plays as a voice without one, bit for bit, whatever its VELO no route reads', () => {
        const { store } = core.storeWith({ a: [saw, square] });
        const play = (velocity?: VoiceVelocity) =>
          render({
            store,
            oscs: [osc({ unison: 3 })],
            params: { spread1: 15, position1: 0.5 },
            envelope: { attack: 0.01, hold: 0, decay: 0.05, sustain: 0.6, release: 0.02 },
            envelopes: [decay(0.3), FLAT],
            routes: [route('gain1', -0.25)],
            velocity,
            frames: 4096,
          });
        const none = play();
        const unity = play({ level: 0.7, amp: 1 });
        expect(unity.left).toEqual(none.left);
        expect(unity.right).toEqual(none.right);
      });

      it.each<[string, VoiceFilterOptions | undefined]>([
        ['no filter', undefined],
        ['the filter', { type: 'lowpass', cutoff: 2000, resonance: 3, gain: 0 }],
      ])('scales the output by its amp with ENV 1, its stages and its sustain: %s', (_, filter) => {
        const { store } = core.storeWith({ a: [saw] });
        const envelope = { attack: 0.01, hold: 0, decay: 0.02, sustain: 0.5, release: 0 };
        const play = (velocity?: VoiceVelocity) =>
          render({ store, envelope, filter, velocity, params: { frequency: 220 }, frames: 2048 });
        const full = play();
        // a quarter: a power of 2, exact in f32
        const quarter = play({ level: 0.5, amp: 0.25 });
        quarter.left.forEach((value, i) => expect(value).toBe(Math.fround(full.left[i] * 0.25)));
        quarter.right.forEach((value, i) => expect(value).toBe(Math.fround(full.right[i] * 0.25)));
      });

      it('VELO moves a param by amount × its level, one value: the voice stays on its mix tables', () => {
        const { store } = core.storeWith({ a: [saw, square, sine] });
        const play = (options: Partial<RenderOptions>) => {
          const shared = core.createVoiceShared();
          const { left } = render({ store, shared, oscs: [osc({ unison: 2 })], frames: 1024, ...options });
          return { left, stats: shared.stats() };
        };
        const routed = play({
          params: { spread1: 10, position1: 0.25 },
          routes: [route('position1', 0.5, 0, 1, VELO)],
          velocity: { level: 0.5, amp: 1 },
        });
        const knob = play({ params: { spread1: 10, position1: 0.5 } });
        expect(routed.left).toEqual(knob.left);
        expect(routed.stats.mixSamples).toBe(knob.stats.mixSamples);
        expect(routed.stats.mixSamples).toBeGreaterThan(0);
      });

      it('glides VELO and the amp to a new velocity in 10 ms, no step', () => {
        const { left } = peak(4096, {
          envelopes: [FLAT, FLAT],
          routes: [route('gain1', -1, 0, 1, VELO)],
          velocity: { level: 0, amp: 1 },
          before: (frame, dsp) => {
            if (frame === 1024) dsp.setVelocity({ level: 0.5, amp: 0.5 });
          },
        });
        expect(left[1023]).toBeCloseTo(1, 4);
        // halfway: VELO at 0.25, the amp at 0.75
        expect(left[1024 + 240]).toBeCloseTo(0.75 * 0.75, 2);
        expect(left[1024 + 480]).toBeCloseTo(0.25, 4);
        expect(left[4095]).toBeCloseTo(0.25, 4);
        expect(maxStep(left)).toBeLessThan(0.003);
      });
    });
  });

  describe('filter', () => {
    const lowpass: VoiceFilterOptions = { type: 'lowpass', cutoff: 1000, resonance: 6, gain: 0 };
    // the steady tone of a sine at `frequency` through the voice (the second half: the filter has settled)
    const tone = (frequency: number, options: Partial<RenderOptions> = {}) => {
      const { store } = core.storeWith({ a: [sine] });
      const { left, right } = render({ store, params: { frequency }, frames: 16384, ...options });
      return { left: left.subarray(8192), right: right.subarray(8192) };
    };

    it.each<[string, VoiceFilterOptions]>([
      ['a resonant lowpass', lowpass],
      ['a highpass', { type: 'highpass', cutoff: 2000, resonance: 0, gain: 0 }],
      ['a bandpass', { type: 'bandpass', cutoff: 1500, resonance: 3, gain: 0 }],
      ['a peaking', { type: 'peaking', cutoff: 800, resonance: 2, gain: 12 }],
      ['a lowshelf', { type: 'lowshelf', cutoff: 500, resonance: 0, gain: -12 }],
    ])('filters the voice as the chart (a BiquadFilterNode) shows: %s', (_, filter) => {
      [100, 400, 1000, 2500, 6000].forEach((frequency) => {
        const dry = toneAmplitude(tone(frequency).left, frequency);
        const wet = toneAmplitude(tone(frequency, { filter }).left, frequency);
        const props = { cutoff: filter.cutoff, resonance: filter.resonance, gain: filter.gain };
        const chart = frequencyResponseDb(filter.type, props, frequency, RATE);
        // the chart stops at ±48 dB
        if (Math.abs(chart) < 48) expect(db(wet / dry)).toBeCloseTo(chart, 1);
        else expect(db(wet / dry)).toBeLessThan(-48);
      });
    });

    it('filters both channels of a unison, the middle voice in both', () => {
      const { store } = core.storeWith({ a: [saw] });
      const { left, right } = render({
        store,
        oscs: [osc({ unison: 3 })],
        params: { spread1: 30 },
        filter: lowpass,
        frames: 4096,
      });
      expect(rms(left)).toBeGreaterThan(0);
      expect(rms(right)).toBeGreaterThan(0);
      expect(rms(left)).not.toBeCloseTo(rms(right), 6);
    });

    it('passes the sound unchanged when off', () => {
      const { store } = core.storeWith({ a: [saw] });
      const off = render({ store, oscs: [osc({ unison: 3 })], params: { spread1: 30 }, frames: 2048 });
      const on = render({
        store,
        oscs: [osc({ unison: 3 })],
        params: { spread1: 30 },
        filter: { type: 'allpass', cutoff: 1000, resonance: 1, gain: 0 },
        frames: 2048,
      });
      expect(on.left).not.toEqual(off.left);
      const before = render({
        store,
        oscs: [osc({ unison: 3 })],
        params: { spread1: 30 },
        filter: null,
        frames: 2048,
      });
      expect(before.left).toEqual(off.left);
      expect(before.right).toEqual(off.right);
    });

    it('moves the cutoff by octaves: base × 2^(amount × the envelope)', () => {
      // 8 kHz three octaves down on the sustain: 1 kHz
      const route: VoiceRoute = { env: 1, param: 'cutoff', amount: -3, min: 10, max: 22050, log: true };
      const decaying: EnvelopeParams = { attack: 0, hold: 0, decay: 0.02, sustain: 1, release: 0 };
      const routed = tone(2500, {
        filter: { ...lowpass, cutoff: 8000 },
        envelopes: [decaying, FLAT],
        routes: [route],
      });
      const knob = tone(2500, { filter: lowpass });
      routed.left.forEach((value, i) => expect(value).toBeCloseTo(knob.left[i], 4));
    });

    it('glides a changed knob on a playing note in about 10 ms, starts a filter turned on from silence', () => {
      const { store } = core.storeWith({ a: [saw] });
      const play = (filter: VoiceFilterOptions, before?: RenderOptions['before']) =>
        render({ store, params: { frequency: 220 }, filter, frames: 8192, before }).left;
      const low = play(lowpass);
      const high = play({ ...lowpass, cutoff: 4000 });
      const changed = play(
        lowpass,
        (frame, dsp) => frame === 2048 && dsp.setFilter({ ...lowpass, cutoff: 4000 })
      );
      const difference = (a: Float32Array, b: Float32Array, from: number, to: number) =>
        rms(a.map((value, i) => value - b[i]).subarray(from, to));
      // 1 ms after: still about the old one; 30 ms after: the new one
      expect(difference(changed, low, 2048, 2096)).toBeLessThan(difference(changed, high, 2048, 2096));
      expect(difference(changed, high, 3488, 3968)).toBeLessThan(0.01 * rms(high));
      const toggled = play(lowpass, (frame, dsp) => {
        if (frame === 4096) dsp.setFilter(null);
        if (frame === 6144) dsp.setFilter(lowpass);
      });
      [...toggled].forEach((value) => expect(Number.isFinite(value)).toBe(true));
    });

    it('takes the knobs of another type at once: the units of the resonance differ', () => {
      // the Q of a bandpass is linear, that of a lowpass in dB: gliding from 1000 to 20 would pass through
      // a lowpass of several hundred dB
      const { store } = core.storeWith({ a: [sine] });
      const bandpass: VoiceFilterOptions = { type: 'bandpass', cutoff: 1000, resonance: 1000, gain: 0 };
      const resonant: VoiceFilterOptions = { type: 'lowpass', cutoff: 1000, resonance: 20, gain: 0 };
      const play = (filter: VoiceFilterOptions, before?: RenderOptions['before']) =>
        render({ store, params: { frequency: 1000 }, filter, frames: 8192, before }).left;
      const peak = (values: Float32Array) => values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
      const steady = play(resonant);
      const changed = play(bandpass, (frame, dsp) => frame === 2048 && dsp.setFilter(resonant));
      expect(peak(changed.subarray(2048))).toBeLessThan(1.5 * peak(steady.subarray(4096)));
    });
  });

  describe('oscillators', () => {
    it('adds both oscillators with their gains', () => {
      const { store } = core.storeWith({ a: [sine], b: [square] });
      const both = render({
        store,
        oscs: [osc(), osc({ table: 'b' })],
        params: { gain1: 0.5, gain2: 0.25 },
        frames: 1024,
      });
      const one = render({ store, frames: 1024 });
      const two = render({ store, oscs: [osc({ table: 'b' })], frames: 1024 });
      both.left.forEach((value, i) => expect(value).toBeCloseTo(0.5 * one.left[i] + 0.25 * two.left[i], 4));
    });

    it('skips an oscillator that is off', () => {
      const { store } = core.storeWith({ a: [sine], b: [square] });
      const second = render({ store, oscs: [null, osc({ table: 'b' })], frames: 512 });
      expect(second.left).toEqual(render({ store, oscs: [osc({ table: 'b' })], frames: 512 }).left);
    });

    it('follows a changing gain per sample', () => {
      const { store } = core.storeWith({ a: [sine] });
      const { left } = render({ store, params: { gain1: (frame) => frame / 512 }, frames: 512 });
      const full = render({ store, frames: 512 }).left;
      left.forEach((value, i) => expect(value).toBeCloseTo((full[i] * i) / 512, 5));
    });
  });

  describe('edge cases', () => {
    it.each([
      ['a frequency of 0', { frequency: 0 }],
      ['a negative frequency', { frequency: -100 }],
      ['a frequency above the nyquist', { frequency: 1e6 }],
      ['a negative spread', { spread1: -50 }],
      ['a changing frequency up to 1 MHz', { frequency: (frame: number) => frame * 10 }],
    ])('renders %s without NaN', (_, params) => {
      const { store } = core.storeWith({ a: [saw, sine] });
      const { left, right } = render({
        store,
        oscs: [osc({ unison: 4 })],
        params: params as Params,
        frames: 4096,
      });
      [...left, ...right].forEach((value) => expect(Number.isFinite(value)).toBe(true));
    });

    it('renders a table of silent frames as silence', () => {
      const { store } = core.storeWith({ a: [[0, 0]] });
      const { left } = render({ store, frames: 256 });
      expect(left.every((value) => value === 0)).toBe(true);
    });
  });

  describe('start frames', () => {
    it('tells the frame it is scheduled at and the one it started at', () => {
      const { store } = core.storeWith({ a: [saw] });
      const before: number[] = [];
      const { dsp } = render({
        store,
        start: 300.5 / RATE,
        frames: 512,
        before: (_, voice) => before.push(voice.startedAt),
      });
      expect(dsp.startFrame).toBe(301);
      // not yet started before the block it starts in
      expect(before.slice(0, 3)).toEqual([-1, -1, -1]);
      expect(dsp.startedAt).toBe(301);
    });

    it('starts at its first block when it is processed after its start', () => {
      const { store } = core.storeWith({ a: [saw] });
      const dsp = core.createVoiceDsp(
        RATE,
        {
          osc: [osc()],
          start: 100 / RATE,
          envelopes: [FLAT, FLAT, FLAT],
          envStart: 100 / RATE,
          phrase: 0,
          routes: [],
          filter: null,
        },
        store,
        seeded(1),
        core.createVoiceShared()
      );
      const values = Object.fromEntries(
        Object.entries(DEFAULTS).map(([name, value]) => [name, Float32Array.of(value)])
      ) as Record<VoiceParam, Float32Array>;
      dsp.process(1280, values, new Float32Array(BLOCK), new Float32Array(BLOCK));
      expect(dsp.startFrame).toBe(100);
      expect(dsp.startedAt).toBe(1280);
    });
  });

  describe('stats', () => {
    it('counts the voices playing and their unison voices until they end', () => {
      const { store } = core.storeWith({ a: [saw] });
      const shared = core.createVoiceShared();
      const during: VoiceStats[] = [];
      render({
        store,
        shared,
        // the second oscillator at detune 0 plays one voice
        oscs: [osc({ unison: 3 }), osc({ unison: 2 })],
        params: { spread1: 10, spread2: 0, gate: (frame) => (frame < 512 ? 1 : 0) },
        frames: 1024,
        before: (frame) => {
          if (frame === 256) during.push(shared.stats());
        },
      });
      expect(during[0]).toMatchObject({ voices: 1, unison: 4 });
      expect(shared.stats()).toMatchObject({ voices: 0, unison: 0 });
    });

    it('counts the samples played directly and from the mix tables, and the mix builds', () => {
      const { store } = core.storeWith({ a: [saw, square] });
      const shared = core.createVoiceShared();
      render({ store, shared, oscs: [osc({ unison: 2 })], params: { spread1: 10 }, frames: 4 * BLOCK });
      const stats = shared.stats();
      // the first block plays directly, the second builds the mixes and plays them, as do the next ones
      expect(stats).toMatchObject({
        directSamples: 2 * BLOCK,
        mixSamples: 2 * 3 * BLOCK,
        builds: 2,
        refused: 0,
      });
      expect(stats.buildCost).toBeGreaterThan(0);
    });

    it('counts each sample once through a crossfade into a new version', () => {
      const { store } = core.storeWith({ a: [saw, square] });
      const shared = core.createVoiceShared();
      render({
        store,
        shared,
        oscs: [osc({ unison: 2 })],
        params: { spread1: 10 },
        frames: 8 * BLOCK,
        before: (frame) => {
          if (frame === 2 * BLOCK) store.set('a', 2, buildLevels([square, saw]));
        },
      });
      const { mixSamples, directSamples } = shared.stats();
      expect(mixSamples + directSamples).toBe(2 * 8 * BLOCK);
    });

    it('plays a moving position directly, without a mix', () => {
      const { store } = core.storeWith({ a: [saw, square] });
      const shared = core.createVoiceShared();
      render({ store, shared, params: { position1: (frame) => frame / 4096 }, frames: 4 * BLOCK });
      expect(shared.stats()).toMatchObject({ mixSamples: 0, directSamples: 4 * BLOCK, builds: 0 });
    });

    it('counts the builds the budget refuses and the peak cost of a block, read once', () => {
      const { store } = core.storeWith({ a: [saw, square] });
      const shared = core.createVoiceShared();
      // 8 voices between two frames: their mixes take more than the budget of one block
      render({
        store,
        shared,
        oscs: [osc({ unison: 8 })],
        params: { spread1: 20, position1: 0.5 },
        frames: 3 * BLOCK,
      });
      const stats = shared.stats();
      expect(stats.refused).toBeGreaterThan(0);
      expect(stats.builds).toBeGreaterThan(1);
      expect(stats.peakCost).toBeGreaterThan(0);
      expect(shared.stats().peakCost).toBe(0);
    });
  });

  describe('table store', () => {
    it('counts the versions it holds and their bytes, a replaced one until no voice holds it', () => {
      const store = core.createTableStore();
      const one = buildLevels([sine]);
      const two = buildLevels([square]);
      const [bytesOne, bytesTwo] = [one.data.byteLength, two.data.byteLength];
      expect(store.stats()).toEqual({ tables: 0, versions: 0, bytes: 0 });
      store.set('a', 1, one);
      expect(store.stats()).toEqual({ tables: 1, versions: 1, bytes: bytesOne });
      const held = store.acquire(store.latest('a') as NonNullable<ReturnType<typeof store.latest>>);
      store.set('a', 2, two);
      expect(store.stats()).toEqual({ tables: 1, versions: 2, bytes: bytesOne + bytesTwo });
      // a stale version is freed at once, never counted
      store.set('a', 1, buildLevels([saw]));
      expect(store.stats()).toEqual({ tables: 1, versions: 2, bytes: bytesOne + bytesTwo });
      store.release(held);
      expect(store.stats()).toEqual({ tables: 1, versions: 1, bytes: bytesTwo });
      store.remove('a');
      expect(store.stats()).toEqual({ tables: 0, versions: 0, bytes: 0 });
    });

    it('counts a freed version off before it hands its buffer over', () => {
      const seen: number[] = [];
      const store = core.createTableStore(() => seen.push(store.stats().bytes));
      store.set('a', 1, buildLevels([sine]));
      store.remove('a');
      expect(seen).toEqual([0]);
    });

    it('keeps the latest version, a stale one is freed at once', () => {
      const freed: unknown[] = [];
      const store = core.createTableStore((levels) => freed.push(levels));
      const one = buildLevels([sine]);
      const two = buildLevels([square]);
      store.set('a', 2, two);
      store.set('a', 1, one);
      expect(store.latest('a')?.levels).toBe(two);
      expect(freed).toEqual([one]);
    });

    it('frees a replaced version once no voice holds it', () => {
      const freed: unknown[] = [];
      const store = core.createTableStore((levels) => freed.push(levels));
      const one = buildLevels([sine]);
      store.set('a', 1, one);
      const held = store.acquire(store.latest('a') as NonNullable<ReturnType<typeof store.latest>>);
      store.set('a', 2, buildLevels([square]));
      expect(freed).toEqual([]);
      store.release(held);
      expect(freed).toEqual([one]);
    });

    it('frees a removed table', () => {
      const freed: unknown[] = [];
      const store = core.createTableStore((levels) => freed.push(levels));
      const one = buildLevels([sine]);
      store.set('a', 1, one);
      store.remove('a');
      expect(store.latest('a')).toBeNull();
      expect(freed).toEqual([one]);
    });
  });
});
