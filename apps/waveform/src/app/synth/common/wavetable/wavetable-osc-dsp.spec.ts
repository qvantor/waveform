import FFT from 'fft.js';
import { buildLevels } from './wavetable-mipmap';
import {
  createTableStore,
  createVoiceDsp,
  createVoiceShared,
  TableStore,
  VoiceOscOptions,
  VoiceShared,
} from './wavetable-osc-dsp';
import { VoiceParam } from './wavetable-osc-params';

const RATE = 48000;
const BLOCK = 128;

// a seeded random() (mulberry32): the phases of a note are reproducible
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

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

const storeWith = (tables: Record<string, number[][]>) => {
  const freed: unknown[] = [];
  const store = createTableStore((levels) => freed.push(levels));
  Object.entries(tables).forEach(([id, frames]) => store.set(id, 1, buildLevels(frames)));
  return { store, freed };
};

type ParamValue = number | ((frame: number) => number);
type Params = Partial<Record<VoiceParam, ParamValue>>;
const DEFAULTS: Record<VoiceParam, number> = {
  frequency: 440,
  gate: 1,
  position1: 0,
  position2: 0,
  detune1: 0,
  detune2: 0,
  spread1: 0,
  spread2: 0,
  gain1: 1,
  gain2: 1,
};

const osc = (config: Partial<VoiceOscOptions> = {}): VoiceOscOptions => ({
  table: 'a',
  unison: 1,
  phase: 0,
  phaseRand: 0,
  ...config,
});

interface RenderOptions {
  store: TableStore;
  oscs?: (VoiceOscOptions | null)[];
  params?: Params;
  frames: number;
  start?: number;
  random?: () => number;
  rate?: number;
  // called before the block at that frame
  before?: (frame: number, dsp: ReturnType<typeof createVoiceDsp>) => void;
  // the resources the voices of a context share; a render has its own by default
  shared?: VoiceShared;
}

// renders a voice block by block: a param is a number (one value per block) or a function of the frame (one
// value per sample)
const render = ({
  store,
  oscs = [osc()],
  params = {},
  frames,
  start = 0,
  random,
  rate = RATE,
  before,
  shared = createVoiceShared(),
}: RenderOptions) => {
  const dsp = createVoiceDsp(rate, { osc: oscs, start }, store, random ?? seeded(1), shared);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  let endedAt = -1;
  for (let frame = 0; frame < frames; frame += BLOCK) {
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

describe('wavetable voice dsp', () => {
  describe('pitch', () => {
    it.each([55, 440, 3520])('plays %s Hz within 0.01 cent', (frequency) => {
      const { store } = storeWith({ a: [sine] });
      const { left } = render({ store, params: { frequency }, frames: 10 * RATE });
      const cents = 1200 * Math.log2(measureFrequency(left) / frequency);
      expect(Math.abs(cents)).toBeLessThan(0.01);
    });

    it('adds the detune of the oscillator in cents', () => {
      const { store } = storeWith({ a: [sine] });
      const { left } = render({ store, params: { frequency: 220, detune1: 1200 }, frames: RATE });
      expect(measureFrequency(left)).toBeCloseTo(440, 2);
    });

    it('steps a changing pitch every 32 samples within 0.1 cent', () => {
      const { store } = storeWith({ a: [sine] });
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
        const { store } = storeWith({ a: [saw] });
        const { left } = render({ store, params: { frequency: binPitch(bin) }, frames: SIZE + 4096 });
        const result = harmonicAnalysis(left, bin);
        expect(result.aliasing).toBeLessThanOrEqual(aliasing + 1);
        expect(result.worstSpur).toBeLessThanOrEqual(spur + 1);
        expect(result.highest).toBeGreaterThanOrEqual(highest);
        expect(result.highest * binPitch(bin)).toBeLessThan(RATE / 2);
      }
    );

    it('plays the harmonics of the additive synthesis at their level', () => {
      const { store } = storeWith({ a: [saw] });
      const bin = 1428;
      const { left } = render({ store, params: { frequency: binPitch(bin) }, frames: SIZE + 4096 });
      const spectrum = powerSpectrum(left);
      // the saw normalized by its peak: harmonic h at 1/h / peak (the levels below their crossfade)
      const peak = Math.max(...saw.map(Math.abs));
      for (const h of [1, 2, 5, 10]) {
        const amplitude = (2 * Math.sqrt(spectrum[h * bin])) / SIZE;
        expect(amplitude).toBeCloseTo(1 / h / peak, 3);
      }
    });

    it('fades a fundamental above the nyquist out to silence', () => {
      const { store } = storeWith({ a: [saw] });
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
      const { store } = storeWith({ a: table, b: [table[100]] });
      const position = Math.fround(100 / 255);
      const { left } = render({ store, params: { position1: position }, frames: 4096 });
      const { left: alone } = render({ store, oscs: [osc({ table: 'b' })], frames: 4096 });
      expect(left).toEqual(alone);
    });

    it('morphs two frames linearly', () => {
      const { store } = storeWith({ a: [sine, square], s: [sine], q: [square] });
      const { left } = render({ store, params: { position1: 0.25 }, frames: 1024 });
      const { left: a } = render({ store, oscs: [osc({ table: 's' })], frames: 1024 });
      const { left: b } = render({ store, oscs: [osc({ table: 'q' })], frames: 1024 });
      // (a table of one frame has its own levels: the same harmonics, other lengths)
      left.forEach((value, i) => expect(value).toBeCloseTo(0.75 * a[i] + 0.25 * b[i], 4));
    });

    it('morphs through the table without clicks', () => {
      const { store } = storeWith({ a: table.slice(0, 32) });
      const { left: morph } = render({ store, params: { position1: (frame) => frame / RATE }, frames: RATE });
      const stationary = Array.from({ length: 32 }, (_, k) =>
        maxStep(render({ store, params: { position1: k / 31 }, frames: 2048 }).left)
      );
      expect(maxStep(morph)).toBeLessThanOrEqual(1.1 * Math.max(...stationary));
    });

    it('clamps a position outside 0..1', () => {
      const { store } = storeWith({ a: [sine, square], s: [sine], q: [square] });
      const below = render({ store, params: { position1: -0.5 }, frames: 512 }).left;
      const above = render({ store, params: { position1: (frame) => 2 + frame }, frames: 512 }).left;
      expect(below).toEqual(render({ store, params: { position1: 0 }, frames: 512 }).left);
      above.forEach((value) => expect(Number.isFinite(value)).toBe(true));
      const q = render({ store, oscs: [osc({ table: 'q' })], frames: 512 }).left;
      // (the moving position plays the levels themselves, the constant one their mix)
      above.forEach((value, i) => expect(value).toBeCloseTo(q[i], 3));
    });

    it('plays a table of one frame at any position', () => {
      const { store } = storeWith({ a: [square], q: [square] });
      const { left } = render({ store, params: { position1: (frame) => frame / 512 }, frames: 512 });
      expect(left).toEqual(render({ store, oscs: [osc({ table: 'q' })], frames: 512 }).left);
    });
  });

  describe('glide', () => {
    it('glides 55 Hz to 7 kHz without steps of the waveform', () => {
      const { store } = storeWith({ a: [saw] });
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
      const { store } = storeWith({ a: [saw] });
      const pitch = (x: number) => (RATE / 2 / 1024) * 2 ** ((x - 1) / 3);
      const play = (x: number) => render({ store, params: { frequency: pitch(x) }, frames: RATE / 2 }).left;
      // level 10 keeps 101 harmonics, level 11 80
      const peak = Math.max(...saw.map(Math.abs));
      // harmonic h of the note at x, against its level in the saw
      const harmonic = (x: number, h: number) => toneAmplitude(play(x), h * pitch(x)) * h * peak;
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
      const { store, freed } = storeWith({ a: [sine], q: [square] });
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
      const store = createTableStore();
      const { left } = render({ store, params: { frequency: 375 }, frames: 1024 });
      const { store: sineStore } = storeWith({ a: [sine] });
      const { left: expected } = render({ store: sineStore, params: { frequency: 375 }, frames: 1024 });
      left.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 4));
    });
  });

  describe('unison', () => {
    it('detunes the voices evenly from -spread/2 to +spread/2, the middle one of an odd count both', () => {
      const { store } = storeWith({ a: [sine] });
      // an octave below and above the note and the note itself: voice 0 left, the middle one both, 2 right
      const { left, right } = render({
        store,
        oscs: [osc({ unison: 3 })],
        params: { frequency: 400, spread1: 2400 },
        frames: RATE,
      });
      const level = 1 / Math.sqrt(2);
      expect(toneAmplitude(left, 200)).toBeCloseTo(level, 2);
      expect(toneAmplitude(left, 400)).toBeCloseTo(level, 2);
      expect(toneAmplitude(left, 800)).toBeCloseTo(0, 2);
      expect(toneAmplitude(right, 200)).toBeCloseTo(0, 2);
      expect(toneAmplitude(right, 400)).toBeCloseTo(level, 2);
      expect(toneAmplitude(right, 800)).toBeCloseTo(level, 2);
    });

    it.each([3, 5, 7])(
      'puts the voices of u%s around the middle one: the channels mirror each other',
      (unison) => {
        const { store } = storeWith({ a: [sine] });
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
          // the voices below the middle from the left, the ones above it continue the turns
          const side = j > middle ? j - 1 : j;
          const inLeft = j === middle || side % 2 === 0;
          const inRight = j === middle || side % 2 === 1;
          expect(toneAmplitude(left, pitch)).toBeCloseTo(inLeft ? level : 0, 2);
          expect(toneAmplitude(right, pitch)).toBeCloseTo(inRight ? level : 0, 2);
          // its mirror (the same detune, the other way) is on the other side
          const mirror = 400 * 2 ** (-cents(j) / 1200);
          if (j !== middle) expect(toneAmplitude(inLeft ? right : left, mirror)).toBeCloseTo(level, 2);
        }
      }
    );

    it('pairs 8 voices into the channels at the level of 4 per channel', () => {
      const { store } = storeWith({ a: [sine] });
      const { left, right } = render({
        store,
        oscs: [osc({ unison: 8 })],
        params: { frequency: 400, spread1: 1400 },
        frames: RATE,
      });
      // voice j at 400 · 2^((j / 7 - 1/2) · 1400 / 1200)
      const pitch = (j: number) => 400 * 2 ** (((j / 7 - 0.5) * 1400) / 1200);
      for (let j = 0; j < 8; j++) {
        const [own, other] = j % 2 === 0 ? [left, right] : [right, left];
        expect(toneAmplitude(own, pitch(j))).toBeCloseTo(0.5, 2);
        expect(toneAmplitude(other, pitch(j))).toBeCloseTo(0, 2);
      }
    });

    it('plays one voice at detune 0', () => {
      const { store } = storeWith({ a: [saw] });
      const unison = render({ store, oscs: [osc({ unison: 8 })], frames: 4096 });
      const single = render({ store, oscs: [osc({ unison: 1 })], frames: 4096 });
      expect(unison.left).toEqual(single.left);
      expect(unison.right).toEqual(single.left);
    });

    // the start of a note over many notes: at Phase rand 1 the voices start at random phases and add up to
    // the power of one voice
    it.each([2, 3, 8])('keeps the level of u%s at that of one voice at Phase rand 1', (unison) => {
      const { store } = storeWith({ a: [saw] });
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
      const { store } = storeWith({ a: [sine] });
      for (const [unison, level] of [
        [1, 1],
        [2, 1],
        [3, 1 / Math.sqrt(2)],
        [8, 0.5],
      ]) {
        // far apart: no beats between the voices
        const { left } = render({
          store,
          oscs: [osc({ unison })],
          params: { frequency: 300, spread1: 4800 },
          frames: RATE,
        });
        expect(toneAmplitude(left, unison === 1 ? 300 : 300 * 2 ** -2)).toBeCloseTo(level, 2);
      }
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
      const { store } = storeWith({ a: [sine] });
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
      const { store } = storeWith({ a: [sine] });
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

    it('fades in within 1.5 ms', () => {
      const { store } = storeWith({ a: [sine] });
      const { left } = render({
        store,
        oscs: [osc({ phase: 0.25, phaseRand: 1e-9 })],
        params: { frequency: 10 },
        frames: 256,
      });
      const wave = (i: number) => Math.sin(2 * Math.PI * (0.25 + (10 * i) / RATE));
      expect(left[0]).toBe(0);
      expect(left[36]).toBeCloseTo(0.5 * wave(36), 3);
      expect(left[72]).toBeCloseTo(wave(72), 3);
    });

    it('shifts every voice by a random share of phaseRand, u1 too', () => {
      const { store } = storeWith({ a: [sine] });
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
      const { store } = storeWith({ a: [sine] });
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
      const { store } = storeWith({ a: [sine] });
      const { left } = render({ store, oscs: [osc({ phase: 0.25 })], start: 300.5 / RATE, frames: 512 });
      expect(left.subarray(0, 301).every((value) => value === 0)).toBe(true);
      expect(left[301]).toBeCloseTo(1, 4);
    });

    // the gate param drops to 0 at the end of the release (setValueAtTime)
    const gateAt =
      (stop: number, value = 0) =>
      (frame: number) =>
        frame < stop ? 1 : value;

    it('stops exactly where the gate drops to 0 and ends', () => {
      const { store } = storeWith({ a: [sine] });
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

    it('fades a stolen voice out within 5 ms from where the gate drops below 0', () => {
      const { store } = storeWith({ a: [sine] });
      const { left, endedAt } = render({
        store,
        oscs: [osc({ phase: 0.25 })],
        params: { frequency: 10, gate: gateAt(256, -1) },
        frames: 2048,
      });
      expect(left[255]).toBeCloseTo(Math.cos((2 * Math.PI * 10 * 255) / RATE), 4);
      expect(left[256 + 120]).toBeCloseTo(0.5 * Math.cos((2 * Math.PI * 10 * 376) / RATE), 2);
      expect(left.subarray(256 + 240).every((value) => value === 0)).toBe(true);
      expect(endedAt).toBeLessThanOrEqual(512);
    });

    it('frees its versions when it ends', () => {
      const { store, freed } = storeWith({ a: [sine] });
      const entry = store.latest('a');
      render({ store, frames: 512, params: { gate: gateAt(100) } });
      store.set('a', 2, buildLevels([square]));
      expect(freed).toEqual([entry?.levels]);
    });

    it('stays silent and ends at a gate closed before its start', () => {
      const { store } = storeWith({ a: [sine] });
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

  describe('oscillators', () => {
    it('adds both oscillators with their gains', () => {
      const { store } = storeWith({ a: [sine], b: [square] });
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
      const { store } = storeWith({ a: [sine], b: [square] });
      const second = render({ store, oscs: [null, osc({ table: 'b' })], frames: 512 });
      expect(second.left).toEqual(render({ store, oscs: [osc({ table: 'b' })], frames: 512 }).left);
    });

    it('follows a changing gain per sample', () => {
      const { store } = storeWith({ a: [sine] });
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
      const { store } = storeWith({ a: [saw, sine] });
      const { left, right } = render({
        store,
        oscs: [osc({ unison: 4 })],
        params: params as Params,
        frames: 4096,
      });
      [...left, ...right].forEach((value) => expect(Number.isFinite(value)).toBe(true));
    });

    it('renders a table of silent frames as silence', () => {
      const { store } = storeWith({ a: [[0, 0]] });
      const { left } = render({ store, frames: 256 });
      expect(left.every((value) => value === 0)).toBe(true);
    });
  });

  describe('table store', () => {
    it('keeps the latest version, a stale one is freed at once', () => {
      const freed: unknown[] = [];
      const store = createTableStore((levels) => freed.push(levels));
      const one = buildLevels([sine]);
      const two = buildLevels([square]);
      store.set('a', 2, two);
      store.set('a', 1, one);
      expect(store.latest('a')?.levels).toBe(two);
      expect(freed).toEqual([one]);
    });

    it('frees a replaced version once no voice holds it', () => {
      const freed: unknown[] = [];
      const store = createTableStore((levels) => freed.push(levels));
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
      const store = createTableStore((levels) => freed.push(levels));
      const one = buildLevels([sine]);
      store.set('a', 1, one);
      store.remove('a');
      expect(store.latest('a')).toBeNull();
      expect(freed).toEqual([one]);
    });
  });
});
