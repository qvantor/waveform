import { readFileSync } from 'fs';
import { join } from 'path';
import FFT from 'fft.js';
import { VOICE_DEFAULTS } from '../../../../test-utils/voice-dsp';
import { wasmCore } from '../../../../test-utils/wasm';
import type { EnvelopeParams } from '../envelope/envelope-curve';
import { buildNoiseLevels } from './noise-levels';
import type {
  VoiceFilterOptions,
  VoiceNoiseOptions,
  VoiceOptions,
  VoiceRoute,
  VoiceVelocity,
} from './voice-options';
import type { WavetableLevels } from './wavetable-levels';
import { VoiceParam } from './wavetable-osc-params';
import {
  createOscScope,
  createTableStoreWasm,
  createVoiceSharedWasm,
  createVoiceWasm,
  OscExports,
} from './wavetable-osc-wasm';

// the noise of a voice in the Rust core (noise.rs): a sample of the store played at a pitch, panned, at a level,
// against the renders of the noise oscillator of the Audio Unit (scripts/renders/run.mjs --only=noise)
const MEASURED: {
  pitch: [number, number][];
  track: [number, number][];
  bend: [boolean, number][];
  level: [number, number][];
  oscillator: number;
  pan: [number, number, number][];
  stereo: [number, number | null, number | null, number | null, number | null][];
  phase: [number, number][];
  rand: [number, number][];
  late: Record<'loop' | 'oneShot', number[]>;
  end: Record<'loop' | 'oneShot', number>;
  mono: { legato: boolean; rand: number; shares: [number, number][] }[];
} = JSON.parse(readFileSync(join(__dirname, '../../../../../../../dsp/measurements/noise.json'), 'utf8'));

const scope = createOscScope(wasmCore<OscExports>('wavetable-osc'));
const BLOCK = 128;
const SOURCE_RATE = 44100;
const FLAT: EnvelopeParams = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
const NOISE: VoiceNoiseOptions = {
  sample: 'noise',
  loop: true,
  keytrack: false,
  start: 0,
  rand: 0,
  level: 1,
  pan: 0,
  cents: 0,
};
// C4 and C5 (MIDI 60, 72)
const C4 = 261.6255653005986;
const C5 = 523.2511306011972;

const sine = (hz: number, seconds: number, amplitude = 1) =>
  Float32Array.from({ length: Math.round(seconds * SOURCE_RATE) }, (_, i) =>
    Math.fround(amplitude * Math.sin((2 * Math.PI * hz * i) / SOURCE_RATE))
  );
// L the sine, R the cosine of one turn over the sample: the share of the sample read is atan2(L, R) / 2π
const TURN = 2 * SOURCE_RATE;
const turn = [
  Float32Array.from({ length: TURN }, (_, i) => Math.sin((2 * Math.PI * i) / TURN)),
  Float32Array.from({ length: TURN }, (_, i) => Math.cos((2 * Math.PI * i) / TURN)),
];
const shareOf = (l: number, r: number) => (Math.atan2(l, r) / (2 * Math.PI) + 1) % 1;

// (the levels of a sample are built once)
const built = new Map<Float32Array[], WavetableLevels>();
const levelsOf = (sample: Float32Array[]) => {
  const known = built.get(sample);
  if (known) return known;
  const levels = buildNoiseLevels(sample, SOURCE_RATE);
  built.set(sample, levels);
  return levels;
};

interface Play {
  sample: Float32Array[];
  noise?: Partial<VoiceNoiseOptions>;
  rate?: number;
  seconds?: number;
  // (a function: of the frame of each sample)
  frequency?: number | ((frame: number) => number);
  // the gate of each block (a value held again: a start again of mono)
  gate?: (frame: number) => number;
  // the pitch bend of every block (cents)
  bend?: number;
  routes?: VoiceRoute[];
  velocity?: VoiceVelocity;
  filter?: VoiceFilterOptions | null;
  envelopes?: EnvelopeParams[];
  // seconds of the context the note and its envelopes start at (envStart before start: a note of a legato phrase)
  start?: number;
  envStart?: number;
  random?: () => number;
  // before block k (its frame)
  before?: (frame: number, voice: ReturnType<typeof createVoiceWasm>) => void;
}

// a note of the noise alone (no oscillator), its output (left, right)
const play = ({
  sample,
  noise = {},
  rate = 48000,
  seconds = 0.5,
  frequency = C5,
  gate = () => 1,
  bend = 0,
  routes = [],
  velocity,
  filter = null,
  envelopes = [FLAT, FLAT, FLAT],
  start = 0,
  envStart = start,
  random = () => 0.5,
  before,
}: Play) => {
  const store = createTableStoreWasm(scope);
  expect(store.set('noise', 1, levelsOf(sample))).toBe(true);
  const shared = createVoiceSharedWasm(scope);
  const options: VoiceOptions = {
    osc: [null, null],
    noise: { ...NOISE, ...noise },
    start,
    envelopes,
    envStart,
    phrase: 1,
    routes,
    filter,
    velocity,
  };
  const voice = createVoiceWasm(scope, rate, options, store, random, shared);
  const n = Math.ceil((seconds * rate) / BLOCK) * BLOCK;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const params = Object.fromEntries(
    Object.entries(VOICE_DEFAULTS).map(([name, value]) => [name, Float32Array.of(value)])
  ) as Record<VoiceParam, Float32Array>;
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  for (let frame = 0; frame < n; frame += BLOCK) {
    params.frequency =
      typeof frequency === 'number'
        ? Float32Array.of(frequency)
        : Float32Array.from({ length: BLOCK }, (_, i) => frequency(frame + i));
    params.gate = Float32Array.of(gate(frame));
    before?.(frame, voice);
    voice.process(frame, params, outL, outR, Float32Array.of(bend));
    left.set(outL, frame);
    right.set(outR, frame);
  }
  voice.end();
  store.remove('noise');
  store.free();
  shared.free();
  return [left, right];
};

// the frequency of a sine by its rising zero crossings over the samples from..to
const frequencyOf = (x: Float32Array, rate: number, from = 4800, to = x.length) => {
  const crossings: number[] = [];
  for (let i = from; i < to - 1; i++)
    if (x[i] <= 0 && x[i + 1] > 0) crossings.push(i + x[i] / (x[i] - x[i + 1]));
  return ((crossings.length - 1) / (crossings[crossings.length - 1] - crossings[0])) * rate;
};
const semitones = (hz: number, base: number) => 12 * Math.log2(hz / base);
// the amplitude of a tone of `hz` in x over its last `n` samples (Hann)
const amplitudeOf = (x: Float32Array, hz: number, rate: number, n = 16384) => {
  const from = x.length - n;
  let [re, im, sum] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const phase = (2 * Math.PI * hz * (from + i)) / rate;
    re += x[from + i] * w * Math.sin(phase);
    im += x[from + i] * w * Math.cos(phase);
    sum += w;
  }
  return (2 * Math.hypot(re, im)) / sum;
};
const dB = (value: number) => 20 * Math.log10(value);
// the amplitude spectrum (dB of a full-scale sine) of the last SIZE samples (Blackman-Harris: sidelobes -92 dB)
const SIZE = 1 << 15;
const WINDOW = Float64Array.from({ length: SIZE }, (_, i) => {
  const t = (2 * Math.PI * i) / (SIZE - 1);
  return 0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t);
});
const WINDOW_SUM = WINDOW.reduce((a, b) => a + b, 0);
const spectrumOf = (x: Float32Array) => {
  const fft = new FFT(SIZE);
  const out = fft.createComplexArray();
  const from = x.length - SIZE;
  fft.realTransform(
    out,
    Array.from({ length: SIZE }, (_, i) => x[from + i] * WINDOW[i])
  );
  return Float64Array.from({ length: SIZE / 2 }, (_, k) =>
    dB((2 * Math.hypot(out[2 * k], out[2 * k + 1])) / WINDOW_SUM + 1e-12)
  );
};
// the loudest component of x more than `away` Hz off `hz` (dB of a full-scale sine)
const loudestOff = (x: Float32Array, hz: number, rate: number, away = 300) => {
  const spectrum = spectrumOf(x);
  let loudest = -Infinity;
  spectrum.forEach((level, k) => {
    if (Math.abs((k * rate) / SIZE - hz) > away && k > 2) loudest = Math.max(loudest, level);
  });
  return loudest;
};

const SINE_1K = [sine(1000, 3)];
const SINE_15K = [sine(15000, 3)];

describe('the noise of a voice', () => {
  describe('pitch', () => {
    it.each([0, 12, -12, 24, 48, -48])('plays the sample %d semitones off its own pitch', (st) => {
      const [left] = play({ sample: SINE_1K, noise: { cents: 100 * st }, seconds: 0.4 });
      expect(semitones(frequencyOf(left, 48000), 1000)).toBeCloseTo(st, 3);
    });

    it('is the pitch of the Audio Unit on its right half: +96 semitones a unit from 50%', () => {
      const right = MEASURED.pitch.filter(([knob]) => knob >= 0.5);
      expect(right.length).toBeGreaterThan(4);
      right.forEach(([knob, st]) => expect(st).toBeCloseTo(96 * (knob - 0.5), 2));
      expect(Math.max(...right.map(([, st]) => st))).toBe(48);
    });

    it('takes Fine in cents on the pitch', () => {
      const [left] = play({ sample: SINE_1K, noise: { cents: 700 + 37 }, seconds: 0.4 });
      expect(1200 * Math.log2(frequencyOf(left, 48000) / 1000)).toBeCloseTo(737, 1);
    });

    it('plays at the pitch of the sample at any rate of the context', () => {
      const [left] = play({ sample: SINE_1K, rate: 44100, seconds: 0.4 });
      expect(frequencyOf(left, 44100)).toBeCloseTo(1000, 1);
    });
  });

  describe('Pitch Track', () => {
    it.each(MEASURED.track)('plays note %d as the renders: %d semitones', (note, st) => {
      const frequency = 440 * 2 ** ((note - 69) / 12);
      const [left] = play({ sample: SINE_1K, noise: { keytrack: true }, frequency, seconds: 0.4 });
      expect(semitones(frequencyOf(left, 48000), 1000)).toBeCloseTo(st, 3);
    });

    it('adds the pitch of its knobs', () => {
      const [left] = play({
        sample: SINE_1K,
        noise: { keytrack: true, cents: 500 },
        frequency: C4,
        seconds: 0.4,
      });
      expect(semitones(frequencyOf(left, 48000), 1000)).toBeCloseTo(-7, 3);
    });

    it.each(MEASURED.bend)('follows the bend only with it (Pitch Track %s: %d semitones up)', (track, st) => {
      const [left] = play({ sample: SINE_1K, noise: { keytrack: track }, bend: 200, seconds: 0.4 });
      expect(semitones(frequencyOf(left, 48000), 1000)).toBeCloseTo(st, 3);
    });

    it('follows the frequency of the note as it glides (a portamento)', () => {
      // an octave up from C4 over 0.1..0.3 s (exponential), then held at C5
      const glide = (frame: number) => C4 * 2 ** Math.min(1, Math.max(0, (frame / 48000 - 0.1) / 0.2));
      const [left] = play({ sample: SINE_1K, noise: { keytrack: true }, frequency: glide, seconds: 0.6 });
      expect(semitones(frequencyOf(left, 48000, 0, 4800), 1000)).toBeCloseTo(-12, 2);
      expect(semitones(frequencyOf(left, 48000, 9600, 9600 + 480), 1000)).toBeCloseTo(-6, 0);
      expect(semitones(frequencyOf(left, 48000, 0.35 * 48000), 1000)).toBeCloseTo(0, 3);
    });
  });

  describe('level and pan', () => {
    it('is the square of its level, on the scale of the oscillators (the renders: as loud as osc A)', () => {
      expect(MEASURED.oscillator).toBeCloseTo(1, 2);
      const full = amplitudeOf(play({ sample: SINE_1K })[0], 1000, 48000);
      expect(full).toBeCloseTo(1, 3);
      MEASURED.level.forEach(([level, measured]) => {
        const [left] = play({ sample: SINE_1K, noise: { level } });
        expect(dB(amplitudeOf(left, 1000, 48000) / full)).toBeCloseTo(measured, 1);
      });
    });

    it('pans a mono sample as the renders, each side against the centre', () => {
      MEASURED.pan.forEach(([knob, left, right]) => {
        const [l, r] = play({ sample: SINE_1K, noise: { pan: 2 * knob - 1 }, seconds: 0.4 });
        expect(amplitudeOf(l, 1000, 48000)).toBeCloseTo(left, 3);
        expect(amplitudeOf(r, 1000, 48000)).toBeCloseTo(right, 3);
      });
    });

    it('plays each channel of a stereo sample on its side, its gain the one of the pan', () => {
      const pair = [sine(1000, 3), sine(1500, 3)];
      MEASURED.stereo.forEach(([knob, l1000, l1500, r1000, r1500]) => {
        const [l, r] = play({ sample: pair, noise: { pan: 2 * knob - 1 }, seconds: 0.4 });
        const level = (x: Float32Array, hz: number) => dB(amplitudeOf(x, hz, 48000) + 1e-12);
        if (l1000 !== null) expect(level(l, 1000)).toBeCloseTo(l1000, 1);
        if (r1500 !== null) expect(level(r, 1500)).toBeCloseTo(r1500, 1);
        // (the other channel: nothing of it on this side)
        expect(level(l, 1500)).toBeLessThan(-100);
        expect(level(r, 1000)).toBeLessThan(-100);
        expect(l1500 === null || l1500 < -100).toBe(true);
        expect(r1000 === null || r1000 < -100).toBe(true);
      });
    });
  });

  describe('start', () => {
    // the share of the sample the first frame reads (8 frames in: the step at 48 kHz back from it)
    const startShare = (noise: Partial<VoiceNoiseOptions>, random: () => number = () => 0.5) => {
      const [l, r] = play({ sample: turn, noise, seconds: 0.01, random });
      return (shareOf(l[8], r[8]) - (8 * SOURCE_RATE) / 48000 / TURN + 1) % 1;
    };

    it.each(MEASURED.phase)('starts at its Start %d as the renders: share %d', (start, share) => {
      expect(startShare({ start })).toBeCloseTo(share, 4);
    });

    it.each(MEASURED.rand)('spreads the starts over Rand² (Rand %d: %d of the sample)', (rand, span) => {
      expect(span).toBeCloseTo(rand * rand, 3);
      expect(startShare({ start: 0.1, rand }, () => 0.6)).toBeCloseTo(0.1 + rand * rand * 0.6, 4);
    });

    it('starts at most at the end: a loop from its start, a one-shot silent (the renders: shares of 1)', () => {
      expect(MEASURED.late.loop.filter((share) => share >= 0.9999).length).toBeGreaterThan(0);
      const share = startShare({ start: 0.8, rand: 0.5 }, () => 0.9);
      expect(Math.min(share, 1 - share)).toBeCloseTo(0, 4);
      const [l, r] = play({ sample: turn, noise: { start: 0.8, rand: 0.5, loop: false }, random: () => 0.9 });
      expect(Math.max(...l.subarray(64).map(Math.abs), ...r.subarray(64).map(Math.abs))).toBe(0);
    });

    it('draws a share only with a noise: a voice without one draws as before', () => {
      let draws = 0;
      const store = createTableStoreWasm(scope);
      const shared = createVoiceSharedWasm(scope);
      const options: VoiceOptions = {
        osc: [null, null],
        start: 0,
        envelopes: [FLAT],
        envStart: 0,
        phrase: 1,
        routes: [],
        filter: null,
      };
      const draw = () => {
        draws++;
        return 0.5;
      };
      createVoiceWasm(scope, 48000, options, store, draw, shared).end();
      expect(draws).toBe(0);
      createVoiceWasm(scope, 48000, { ...options, noise: NOISE }, store, draw, shared).end();
      expect(draws).toBe(1);
      store.free();
      shared.free();
    });
  });

  describe('loop and one-shot', () => {
    it('stops a one-shot at its end, a loop goes on (the renders: a sample of 0.5 s)', () => {
      expect(MEASURED.end.oneShot).toBeCloseTo(0.5, 1);
      expect(MEASURED.end.loop).toBeGreaterThan(1.4);
      const short = turn.map((channel) => channel.slice(0, SOURCE_RATE / 2));
      const [once] = play({ sample: short, noise: { loop: false }, seconds: 1 });
      const [loop] = play({ sample: short, seconds: 1 });
      const last = (x: Float32Array) => {
        let i = x.length - 1;
        while (i >= 0 && Math.abs(x[i]) <= 1e-6) i--;
        return i / 48000;
      };
      expect(last(once)).toBeCloseTo(0.5, 2);
      expect(last(loop)).toBeGreaterThan(0.99);
    });

    it.each([
      ['at its pitch', 0, 0.7],
      ['two octaves up (a level of its own)', 2400, 0.95],
      ['up a fifth (a kernel below the nyquist)', 700, 0.55],
    ])('loops a seamless sample seamlessly %s', (_, cents, start) => {
      // 1 kHz over 3 s, from where its seam comes within the last SIZE samples of 1.2 s
      const [left] = play({ sample: SINE_1K, noise: { cents, start }, seconds: 1.2 });
      const hz = 1000 * 2 ** (cents / 1200);
      expect(loudestOff(left, hz, 48000)).toBeLessThan(-80);
    });
  });

  describe('band limit', () => {
    // a sine of 15 kHz at 44.1 kHz: its images (pitched down) and aliases (up) at most -70 dB, its level within 1 dB
    // where it is below the nyquist (the renders: images at -28 dB down an octave)
    it.each([
      [48000, 0],
      [48000, 1],
      [48000, 12],
      [48000, -12],
      [48000, -24],
      [44100, 1],
      [44100, 7],
      [44100, -12],
      [96000, 12],
    ])('at %d Hz, %d semitones', (rate, st) => {
      const [left] = play({ sample: SINE_15K, noise: { cents: 100 * st }, rate, seconds: (2 * SIZE) / rate });
      const hz = 15000 * 2 ** (st / 12);
      if (hz < rate / 2) expect(dB(amplitudeOf(left, hz, rate))).toBeGreaterThan(-1);
      expect(loudestOff(left, hz, rate)).toBeLessThan(-70);
    });

    it('keeps the treble up to 0.74 of the nyquist at any step', () => {
      // (the cutoffs an eighth of an octave apart, the stopband of each at most at the nyquist of the output)
      for (const cents of [5, 40, 90, 160, 500, 1150, 1500]) {
        const step = (SOURCE_RATE / 44100) * 2 ** (cents / 1200);
        const hz = 0.73 * 22050;
        const source = hz / step;
        const [left] = play({ sample: [sine(source, 3)], noise: { cents }, rate: 44100, seconds: 0.5 });
        expect(dB(amplitudeOf(left, hz, 44100))).toBeGreaterThan(-1);
      }
    });
  });

  describe('routes and knobs', () => {
    it('moves its level, pan and pitch by its routes (VELO here)', () => {
      const velocity = { level: 1, amp: 1 };
      const [l, r] = play({
        sample: SINE_1K,
        velocity,
        routes: [
          { source: 3, param: 'noise.level', amount: -0.5, min: 0, max: 1 },
          { source: 3, param: 'noise.pan', amount: -1, min: -1, max: 1 },
          { source: 3, param: 'noise.pitch', amount: 1200, min: -4800, max: 4800 },
          { source: 3, param: 'noise.fine', amount: -50, min: -100, max: 100 },
        ],
      });
      const hz = 1000 * 2 ** (1150 / 1200);
      expect(frequencyOf(l, 48000)).toBeCloseTo(hz, 0);
      expect(amplitudeOf(l, hz, 48000)).toBeCloseTo(0.25 * 2 * (1 - 0.17213), 3);
      expect(amplitudeOf(r, hz, 48000)).toBeLessThan(1e-6);
    });

    it('glides to new knobs in 10 ms, the cents at once', () => {
      const AT = 38 * BLOCK;
      const [left] = play({
        sample: SINE_1K,
        seconds: 0.3,
        before: (frame, voice) => {
          if (frame === AT) voice.setKnobs('noise', { level: 0.5, pan: 0, cents: 1200 });
        },
      });
      expect(frequencyOf(left, 48000, AT)).toBeCloseTo(2000, 0);
      expect(amplitudeOf(left, 2000, 48000, 4096)).toBeCloseTo(0.25, 3);
      // (halfway through the glide the level is 0.75: 0.5625)
      const peak = Math.max(...left.subarray(AT + 230, AT + 250).map(Math.abs));
      expect(peak).toBeGreaterThan(0.45);
      expect(peak).toBeLessThan(0.6);
    });

    it('goes through the filter and ENV 1 of the voice', () => {
      const [open] = play({ sample: SINE_15K });
      const [filtered] = play({
        sample: SINE_15K,
        filter: { type: 'lowpass', cutoff: 1000, resonance: 0, gain: 0 },
      });
      expect(dB(amplitudeOf(filtered, 15000, 48000) / amplitudeOf(open, 15000, 48000))).toBeLessThan(-40);
      const [half] = play({ sample: SINE_1K, envelopes: [{ ...FLAT, sustain: 0.5 }, FLAT, FLAT] });
      expect(amplitudeOf(half, 1000, 48000)).toBeCloseTo(0.5, 3);
    });

    it('fades in over 1.5 ms in a legato phrase (its envelopes are at the level of the phrase)', () => {
      const [left] = play({
        sample: [new Float32Array(SOURCE_RATE).fill(1)],
        start: 0.1,
        envStart: 0,
        seconds: 0.2,
      });
      const first = Math.round(0.1 * 48000);
      expect(left[first]).toBe(0);
      expect(left[first + 36]).toBeCloseTo(0.5, 1);
      expect(left[first + 72]).toBeCloseTo(1, 3);
    });
  });

  describe('mono', () => {
    it('goes on through a start again of the envelopes (the renders: the noise never starts again)', () => {
      MEASURED.mono.forEach(({ shares }) => {
        // (0.5 of the sample a second: 0.02 s apart, 0.01 of it)
        expect(shares[1][1] - shares[0][1]).toBeCloseTo(0.01, 3);
        expect(shares[3][1] - shares[2][1]).toBeCloseTo(0.01, 3);
      });
      const [held] = play({ sample: turn, seconds: 0.3 });
      const [again] = play({ sample: turn, seconds: 0.3, gate: (frame) => (frame >= 40 * BLOCK ? 1.5 : 1) });
      expect(again).toEqual(held);
    });
  });

  describe('store', () => {
    it('keeps the latest sample of an id and the one a voice plays, no more', () => {
      const store = createTableStoreWasm(scope);
      const shared = createVoiceSharedWasm(scope);
      const samples = Array.from({ length: 6 }, (_, k) => [sine(200 + 100 * k, 0.2)]);
      store.set('noise', 1, buildNoiseLevels(samples[0], SOURCE_RATE));
      const options: VoiceOptions = {
        osc: [null, null],
        noise: NOISE,
        start: 0,
        envelopes: [FLAT],
        envStart: 0,
        phrase: 1,
        routes: [],
        filter: null,
      };
      const voice = createVoiceWasm(scope, 48000, options, store, () => 0.5, shared);
      samples
        .slice(1)
        .forEach((sample, k) => store.set('noise', k + 2, buildNoiseLevels(sample, SOURCE_RATE)));
      expect(store.stats()).toMatchObject({ tables: 1, versions: 2 });
      voice.end();
      expect(store.stats()).toMatchObject({ tables: 1, versions: 1 });
      store.remove('noise');
      expect(store.stats()).toMatchObject({ tables: 0, versions: 0, bytes: 0 });
      store.free();
      shared.free();
    });

    it('builds a mono sample from a stereo file of equal channels', () => {
      const one = sine(300, 0.1);
      expect(buildNoiseLevels([one, one.slice()], SOURCE_RATE).frames).toBe(1);
      expect(buildNoiseLevels([one, sine(301, 0.1)], SOURCE_RATE).frames).toBe(2);
    });
  });
});
