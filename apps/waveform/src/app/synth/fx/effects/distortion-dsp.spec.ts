// first: the Math of the wasm core for both
import '../../../../test-utils/js-math';
import FFT from 'fft.js';
import { FX_PARAMS } from '@waveform/preset-schema';
import { wasmCore } from '../../../../test-utils/wasm';
import {
  createDistortionDsp,
  DC_CUTOFF,
  DISTORTION_LATENCY,
  DistortionDspParams,
  TONE_OPEN,
} from './distortion-dsp';
import { makeupGain, REFERENCE_PEAK } from './distortion-makeup';
import { DISTORTION_MODES } from './distortion-modes';
import { createDistortionWasm, DistortionExports } from './distortion-wasm';
import { createDcBlocker } from './dsp';

type CreateDistortion = typeof createDistortionDsp;
// both cores: the TS one and the Rust one (dsp/distortion), one instance of it for the spec (a scope)
const core = wasmCore<DistortionExports>('distortion');
const CORES: [string, CreateDistortion][] = [
  ['ts', createDistortionDsp],
  ['wasm', (sampleRate, options) => createDistortionWasm(core, sampleRate, options)],
];
// the core the specs run (describe.each sets it)
let create: CreateDistortion = createDistortionDsp;

const SAMPLE_RATE = 48000;
const BLOCK = 128;
const [SOFT, HARD] = DISTORTION_MODES.map((_, i) => i);
// clean: hard clip without drive passes everything within ±1, the tone is open
const BASE: DistortionDspParams = { mode: HARD, drive: 0, tone: TONE_OPEN, level: 0 };

type Input = (frame: number) => number;
interface Change {
  at: number;
  params: Partial<DistortionDspParams>;
}

const silence: Input = () => 0;
const impulse =
  (amplitude = 1): Input =>
  (frame) =>
    frame === 0 ? amplitude : 0;
const constant =
  (value: number): Input =>
  () =>
    value;
const sine =
  (freq: number, amplitude = 1): Input =>
  (frame) =>
    amplitude * Math.sin((2 * Math.PI * freq * frame) / SAMPLE_RATE);
// a band-limited wave like an oscillator plays it (no DC of its own): `period` frames of the sum of its
// partials 1..count (term(k, n)), with a peak of 1
const periodic = (period: number, count: number, term: (k: number, n: number) => number): Input => {
  const table = Array.from({ length: period }, (_, n) => {
    let sum = 0;
    for (let k = 1; k <= count; k++) sum += term(k, n);
    return sum;
  });
  const loudest = Math.max(...table.map(Math.abs));
  return (frame) => table[frame % period] / loudest;
};
// a narrow pulse (10 %) of 256 frames up to 0.45·fs: asymmetric, the curve clips its wide side and hardly
// its narrow one
const PULSE = periodic(
  256,
  115,
  (k, n) => (Math.sin(k * Math.PI * 0.1) / k) * Math.cos((2 * Math.PI * k * n) / 256)
);
const pulse =
  (amplitude: number): Input =>
  (frame) =>
    amplitude * PULSE(frame);

// renders in render quanta like the worklet, the changes apply at the start of the block holding `at`
// (in frames); the right input is the left one unless given; `idle`: per block, skipped after it
const render = (
  params: Partial<DistortionDspParams>,
  frames: number,
  left: Input,
  { changes = [], right = left }: { changes?: Change[]; right?: Input } = {}
) => {
  const dsp = create(SAMPLE_RATE, { params: { ...BASE, ...params } });
  const length = Math.ceil(frames / BLOCK) * BLOCK;
  const [L, R] = [new Float32Array(length), new Float32Array(length)];
  const [inL, inR] = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const idle: boolean[] = [];
  for (let start = 0; start < length; start += BLOCK) {
    changes
      .filter(({ at }) => Math.floor(at / BLOCK) * BLOCK === start)
      .forEach((change) => dsp.set(change.params));
    for (let i = 0; i < BLOCK; i++) {
      inL[i] = left(start + i);
      inR[i] = right(start + i);
    }
    dsp.process(inL, inR, L.subarray(start, start + BLOCK), R.subarray(start, start + BLOCK));
    idle.push(dsp.idle);
  }
  return { L, R, idle };
};

// the power spectrum of N samples from `from`; a tone of whole cycles in N falls on one bin
const N = 8192;
const spectrum = (data: ArrayLike<number>, from: number) => {
  const fft = new FFT(N);
  const out = fft.createComplexArray();
  fft.realTransform(
    out,
    Array.from({ length: N }, (_, i) => data[from + i])
  );
  return Array.from({ length: N / 2 }, (_, k) => out[2 * k] ** 2 + out[2 * k + 1] ** 2);
};
// the frequency of bin k
const binFreq = (k: number) => (k * SAMPLE_RATE) / N;
const db = (power: number) => 10 * Math.log10(power + 1e-300);

// power of the inharmonic bins (below maxFreq) against the harmonics of bin k0: what folded back from above
// the nyquist
const aliasDb = (data: ArrayLike<number>, from: number, k0: number, maxFreq = SAMPLE_RATE / 2) => {
  const power = spectrum(data, from);
  let harmonics = 0;
  let aliases = 0;
  power.forEach((value, k) => {
    if (k === 0 || binFreq(k) > maxFreq) return;
    if (k % k0 === 0) harmonics += value;
    else aliases += value;
  });
  return db(aliases) - db(harmonics);
};

const maxStep = (data: ArrayLike<number>, from: number, to: number) => {
  let max = 0;
  for (let i = from + 1; i < to; i++) max = Math.max(max, Math.abs(data[i] - data[i - 1]));
  return max;
};

const peak = (data: Float32Array | Float64Array, from = 0) =>
  Math.max(...Array.from(data.subarray(from), Math.abs));
const mean = (data: ArrayLike<number>, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i];
  return sum / (to - from);
};

const rms = (data: ArrayLike<number>, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (to - from));
};
const toGain = (db: number) => 10 ** (db / 20);

// the dc blocker is the last stage: undone, the output of a constant reads the gains directly
const R = Math.exp((-2 * Math.PI * DC_CUTOFF) / SAMPLE_RATE);
const unblock = (data: Float32Array) => {
  const out = new Float64Array(data.length);
  let x = 0;
  let last = 0;
  data.forEach((y, n) => {
    x += y - R * last;
    last = y;
    out[n] = x;
  });
  return out;
};

describe.each(CORES)('distortion dsp, %s core', (_, coreOf) => {
  beforeAll(() => {
    create = coreOf;
  });

  it('the open tone is the top of the tone range', () => {
    expect(TONE_OPEN).toBe(FX_PARAMS.distortion.tone.max);
  });

  it('passes a signal within ±1 unchanged when clean, delayed by its latency', () => {
    const { L } = render({}, 512, impulse(0.25));
    const loudest = Array.from(L).reduce(
      (best, value, i) => (Math.abs(value) > Math.abs(L[best]) ? i : best),
      0
    );
    expect(loudest).toBe(DISTORTION_LATENCY);

    const input = sine(1000, 0.25);
    const { L: out } = render({}, 4800, input);
    // the dc blocker lifts the highs a little (+0.003 dB) and shifts the phase of 1 kHz by 0.3°
    const expected = Float64Array.from({ length: 4800 }, (_, i) =>
      i < DISTORTION_LATENCY ? 0 : input(i - DISTORTION_LATENCY)
    );
    createDcBlocker(DC_CUTOFF, SAMPLE_RATE).processBlock(expected, expected.length);
    for (let i = 2 * DISTORTION_LATENCY; i < 4800; i++) {
      expect(Math.abs(out[i] - expected[i])).toBeLessThan(0.002);
    }
  });

  it('hard clip cuts the peaks of a loud sine at full scale, the makeup gain brings the plateaus down', () => {
    const { L } = render({ drive: 12 }, 9600, sine(500, 0.5));
    const from = 4 * DISTORTION_LATENCY;
    const ceiling = makeupGain(HARD, 12);
    // band-limiting the square edges overshoots a little
    expect(peak(L, from)).toBeGreaterThan(ceiling);
    expect(peak(L, from)).toBeLessThan(1.2 * ceiling);
    // most of the wave sits on the plateaus
    const flat = Array.from(L.subarray(from)).filter(
      (value) => Math.abs(Math.abs(value) - ceiling) < 0.05 * ceiling
    );
    expect(flat.length / (L.length - from)).toBeGreaterThan(0.6);
  });

  it.each([
    ['soft', SOFT],
    ['hard', HARD],
  ])('%s clip keeps the loudness of the reference at every drive', (_, mode) => {
    const k0 = 171;
    const input = sine(binFreq(k0), REFERENCE_PEAK);
    [0, 6, 9, 12].forEach((drive) => {
      const { L } = render({ mode, drive }, 2 * N, input);
      // the harmonics above the nyquist are gone, a little of the loudness with them
      expect(Math.abs(20 * Math.log10(rms(L, N, 2 * N) / (REFERENCE_PEAK / Math.SQRT2)))).toBeLessThan(0.3);
    });
  });

  it('a louder sound comes out quieter than it went in, a quieter one louder', () => {
    const k0 = 171;
    const change = (amplitude: number) => {
      const { L } = render({ drive: 12 }, 2 * N, sine(binFreq(k0), amplitude));
      return 20 * Math.log10(rms(L, N, 2 * N) / (amplitude / Math.SQRT2));
    };
    expect(change(1)).toBeLessThan(-5);
    expect(change(0.25)).toBeGreaterThan(3);
  });

  it('soft clip: more drive, more of the 3rd harmonic, the peaks stay below full scale until it squares', () => {
    // 1 kHz on a bin: k0 cycles in N samples
    const k0 = 171;
    const harmonics = [0, 4, 8, 12].map((drive) => {
      const { L } = render({ mode: SOFT, drive }, 2 * N, sine(binFreq(k0), 0.5));
      // a nearly square wave overshoots a little once band-limited
      expect(peak(L, N)).toBeLessThan((drive <= 12 ? 1 : 1.2) * makeupGain(SOFT, drive));
      const power = spectrum(L, N);
      return db(power[3 * k0]) - db(power[k0]);
    });
    harmonics.slice(1).forEach((value, i) => expect(value).toBeGreaterThan(harmonics[i]));
  });

  it.each([
    ['soft', SOFT],
    ['hard', HARD],
  ])('%s clip is symmetric: no DC and no even harmonics', (_, mode) => {
    const k0 = 171;
    // the dc blocker has settled after the start of the sine
    const { L } = render({ mode, drive: 12 }, 3 * N, sine(binFreq(k0), 0.5));
    const power = spectrum(L, 2 * N);
    const fundamental = db(power[k0]);
    expect(db(power[0]) - fundamental).toBeLessThan(-100);
    [2, 4, 6, 8].forEach((n) => expect(db(power[n * k0]) - fundamental).toBeLessThan(-100));
    // the odd ones are there
    expect(db(power[3 * k0]) - fundamental).toBeGreaterThan(-30);
  });

  it.each([
    // a high note hit hard: its harmonics above the nyquist would fold back as inharmonic tones
    { name: 'hard clip of 7 kHz', mode: HARD, k0: 1195, drive: 12, better: 20, below: -45 },
    { name: 'soft clip of 2 kHz', mode: SOFT, k0: 341, drive: 12, better: 25, below: -95 },
  ])('$name keeps the aliases far below the ones of a naive curve', ({ mode, k0, drive, better, below }) => {
    const input = sine(binFreq(k0), 0.5);
    const { L } = render({ mode, drive }, 2 * N, input);
    const { shape } = DISTORTION_MODES[mode];
    const gain = 10 ** (drive / 20);
    const naive = Array.from({ length: 2 * N }, (_value, i) => shape(input(i) * gain));
    const oversampled = aliasDb(L, N, k0);
    expect(oversampled).toBeLessThan(aliasDb(naive, N, k0) - better);
    expect(oversampled).toBeLessThan(below);
  });

  it('level scales the output', () => {
    const input = sine(700, 0.8);
    const { L: unity } = render({ drive: 12 }, 2048, input);
    const { L: quieter } = render({ drive: 12, level: -6 }, 2048, input);
    const gain = 10 ** (-6 / 20);
    unity.forEach((value, i) => expect(quieter[i]).toBeCloseTo(value * gain, 6));
  });

  it('tone darkens the distortion: the harmonics above it fall, the fundamental stays', () => {
    const k0 = 171;
    const input = sine(binFreq(k0), 0.5);
    const open = spectrum(render({ drive: 12 }, 2 * N, input).L, N);
    const dark = spectrum(render({ drive: 12, tone: 1000 }, 2 * N, input).L, N);
    expect(db(dark[k0]) - db(open[k0])).toBeGreaterThan(-4);
    [7, 9, 11].forEach((n) => expect(db(dark[n * k0]) - db(open[n * k0])).toBeLessThan(-25));
  });

  it('a tone below the top is a lowpass, the top is open', () => {
    const k0 = 1707;
    const input = sine(binFreq(k0), 0.25);
    const open = spectrum(render({}, 2 * N, input).L, N);
    const closed = spectrum(render({ tone: 12000 }, 2 * N, input).L, N);
    // 10 kHz: within the oversampler ripple when open, the lowpass takes off a little below the top
    expect(Math.abs(db(open[k0]) - db(0.25 ** 2 * (N / 2) ** 2))).toBeLessThan(0.1);
    expect(db(closed[k0]) - db(open[k0])).toBeLessThan(-1);
  });

  it('drive, its makeup and level changes glide instead of stepping', () => {
    const at = 4096;
    const L = unblock(
      render({}, 12000, constant(0.01), { changes: [{ at, params: { drive: 12, level: -6 } }] }).L
    );
    const target = 0.01 * toGain(12) * makeupGain(HARD, 12) * toGain(-6);
    expect(L[at - 1]).toBeCloseTo(0.01, 6);
    expect(maxStep(L, at - 1, at + 2000)).toBeLessThan(0.0005);
    expect(L[at + 1]).toBeLessThan(0.0105);
    expect(L[11000]).toBeCloseTo(target, 5);
  });

  it('a new mode crossfades the curves', () => {
    const at = 4096;
    // a constant over the ceiling: tanh(2) on soft clip, 1 on hard clip
    const L = unblock(
      render({ mode: SOFT }, 12000, constant(2), { changes: [{ at, params: { mode: HARD } }] }).L
    );
    expect(L[at - 1]).toBeCloseTo(Math.tanh(2) * makeupGain(SOFT, 0), 6);
    expect(maxStep(L, at - 1, at + 2000)).toBeLessThan(0.0005);
    expect(L[11000]).toBeCloseTo(makeupGain(HARD, 0), 5);
  });

  it('a new mode and a new drive together glide too, each curve with its own makeup', () => {
    const at = 4096;
    const L = unblock(
      render({ mode: SOFT, drive: 0 }, 12000, constant(0.3), {
        changes: [{ at, params: { mode: HARD, drive: 12 } }],
      }).L
    );
    expect(L[at - 1]).toBeCloseTo(Math.tanh(0.3) * makeupGain(SOFT, 0), 6);
    expect(maxStep(L, at - 1, at + 3000)).toBeLessThan(0.004);
    // 0.3 × 12 dB is over the ceiling
    expect(L[11000]).toBeCloseTo(makeupGain(HARD, 12), 5);
  });

  it('a mode changed back during a fade turns the fade around where it is', () => {
    const at = 4096;
    const back = at + 2 * BLOCK;
    const input = sine(1500, 0.5);
    const there = render({ mode: SOFT, drive: 12 }, 12000, input, {
      changes: [{ at, params: { mode: HARD } }],
    }).L;
    const turned = render({ mode: SOFT, drive: 12 }, 12000, input, {
      changes: [
        { at, params: { mode: HARD } },
        { at: back, params: { mode: SOFT } },
      ],
    }).L;
    const soft = render({ mode: SOFT, drive: 12 }, 12000, input).L;
    expect(Array.from(turned.subarray(0, back))).toEqual(Array.from(there.subarray(0, back)));
    // a third of the way to hard clip: turning around starts from there (from hard clip it would step)
    const after = (data: Float32Array) => Array.from(data.subarray(back, back + 8));
    const offset = (a: Float32Array, b: Float32Array) =>
      Math.max(...after(a).map((v, i) => Math.abs(v - after(b)[i])));
    expect(offset(there, soft)).toBeGreaterThan(0.01);
    expect(offset(turned, there)).toBeLessThan(0.003);
    for (let i = 11000; i < 11100; i++) expect(turned[i]).toBeCloseTo(soft[i], 4);
  });

  it('the open tone fades in and out', () => {
    const at = 4096;
    const k0 = 1707;
    const { L } = render({}, 12000, sine(binFreq(k0), 0.25), { changes: [{ at, params: { tone: 500 } }] });
    const before = peak(L.subarray(at - 512, at));
    // closing it takes a few ms, so the highs don't click away
    expect(peak(L.subarray(at, at + 64))).toBeGreaterThan(0.8 * before);
    expect(peak(L.subarray(10000, 12000))).toBeLessThan(0.1 * before);
  });

  it('starts with its params, without a glide', () => {
    const L = unblock(render({ drive: 12, level: -6 }, 1024, constant(0.01)).L);
    expect(L[2 * DISTORTION_LATENCY]).toBeCloseTo(0.01 * toGain(12) * makeupGain(HARD, 12) * toGain(-6), 6);
  });

  it('a mode out of range takes the nearest one', () => {
    const L = unblock(render({ mode: 7 }, 1024, constant(2)).L);
    expect(L[1000]).toBeCloseTo(1, 6);
    const soft = unblock(render({ mode: -1 }, 1024, constant(2)).L);
    expect(soft[1000]).toBeCloseTo(Math.tanh(2) * makeupGain(SOFT, 0), 6);
  });

  it('processes the channels on their own', () => {
    const { L, R } = render({ drive: 12 }, 2048, sine(440, 0.5), { right: silence });
    expect(peak(L)).toBeGreaterThan(0.3);
    expect(peak(R)).toBe(0);
  });

  it('after a silence it is cleared and skips the blocks, the next sound starts like in a new one', () => {
    const loud = 2048;
    // the tail of the dc blocker dies out in about half a second
    const quiet = SAMPLE_RATE;
    const input: Input = (frame) => {
      if (frame < loud) return sine(440, 0.8)(frame);
      return frame < loud + quiet ? 0 : impulse(0.5)(frame - loud - quiet);
    };
    const { L } = render({ drive: 12, tone: 1000 }, loud + quiet + 512, input);
    L.subarray(loud + quiet - 8192, loud + quiet).forEach((value) => expect(value).toBe(0));
    const fresh = render({ drive: 12, tone: 1000 }, 512, impulse(0.5)).L;
    expect(Array.from(L.subarray(loud + quiet))).toEqual(Array.from(fresh));
  });

  it.each([
    ['soft', SOFT],
    ['hard', HARD],
  ])('%s clip of an asymmetric wave: the dc blocker takes out the DC the curve adds', (_, mode) => {
    const length = 3 * N;
    const { L } = render({ mode, drive: 12 }, length, pulse(0.5));
    // whole periods of the pulse, once the blocker has settled
    const from = length - N;
    const loudness = rms(L, from, length);
    expect(Math.abs(mean(L, from, length))).toBeLessThan(1e-3 * loudness);
    // without it, a fifth of the output would be DC
    expect(Math.abs(mean(unblock(L), from, length))).toBeGreaterThan(0.2 * loudness);
  });

  it('after an asymmetric wave the tail of the dc blocker fades out without a step, then it idles', () => {
    const loud = N;
    const input: Input = (frame) => (frame < loud ? pulse(0.5)(frame) : 0);
    const { L } = render({ drive: 12 }, loud + SAMPLE_RATE, input);
    // the DC it held back while the wave played, given back slowly: no cut, no step
    const tail = loud + 4 * DISTORTION_LATENCY;
    expect(Math.abs(L[tail])).toBeGreaterThan(0.01);
    expect(maxStep(L, tail, loud + SAMPLE_RATE)).toBeLessThan(1e-4);
    L.subarray(L.length - 8192).forEach((value) => expect(value).toBe(0));
  });

  describe('the work of a silent chain', () => {
    it('a new one skips every block of silence', () => {
      const { idle } = render({ drive: 12 }, SAMPLE_RATE, () => 0);
      expect(idle.every(Boolean)).toBe(true);
    });

    // the tails of the dc blocker (one pole at 5 Hz) and the tone after the step to silence: 0.57 s after a
    // sine, 0.63 s after the DC the curve added to an asymmetric wave
    it.each([
      ['a sine', sine(440, 0.8)],
      ['an asymmetric wave', pulse(0.5)],
    ])('after %s it skips the blocks within 0.7 s of silence, and keeps skipping', (_, wave) => {
      const loud = N;
      const { idle } = render({ drive: 12 }, loud + SAMPLE_RATE, (frame) => (frame < loud ? wave(frame) : 0));
      const first = idle.findIndex((skipped, block) => skipped && block * BLOCK >= loud);
      expect(idle[loud / BLOCK - 1]).toBe(false);
      expect(first).toBeGreaterThan(0);
      expect((first + 1) * BLOCK - loud).toBeLessThanOrEqual(0.7 * SAMPLE_RATE);
      expect(idle.slice(first).every(Boolean)).toBe(true);
    });
  });

  it('soft clip of a saw with partials up to the nyquist: the curve gets no images of the top ones', () => {
    // 521 Hz, partials up to 23.99 kHz, as an oscillator plays them; through a curve their images (cut
    // at the nyquist, -6 dB just above it) would mix with every partial into inharmonic tones (-65 dB)
    const k0 = 89;
    const saw = periodic(N, Math.floor(N / 2 / k0), (k, n) => Math.sin((2 * Math.PI * k * k0 * n) / N) / k);
    const { L } = render({ mode: SOFT, drive: 12 }, 2 * N, (frame) => 0.5 * saw(frame));
    expect(aliasDb(L, N, k0, 16000)).toBeLessThan(-85);
  });

  it('a change while silent applies at once', () => {
    const quiet = 1024;
    const input: Input = (frame) => (frame < quiet ? 0 : 0.01);
    const L = unblock(render({}, quiet + 512, input, { changes: [{ at: 0, params: { drive: 12 } }] }).L);
    expect(L[quiet + 2 * DISTORTION_LATENCY]).toBeCloseTo(0.01 * toGain(12) * makeupGain(HARD, 12), 6);
  });
});
