import FFT from 'fft.js';
import { FX_PARAMS } from '@waveform/preset-schema';
import { createDistortionDsp, DISTORTION_LATENCY, DistortionDspParams, TONE_OPEN } from './distortion-dsp';
import { makeupGain, REFERENCE_PEAK } from './distortion-makeup';
import { DISTORTION_MODES } from './distortion-modes';

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

// renders in render quanta like the worklet, the changes apply at the start of the block holding `at`
// (in frames); the right input is the left one unless given
const render = (
  params: Partial<DistortionDspParams>,
  frames: number,
  left: Input,
  { changes = [], right = left }: { changes?: Change[]; right?: Input } = {}
) => {
  const dsp = createDistortionDsp(SAMPLE_RATE, { params: { ...BASE, ...params } });
  const length = Math.ceil(frames / BLOCK) * BLOCK;
  const [L, R] = [new Float32Array(length), new Float32Array(length)];
  const [inL, inR] = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  for (let start = 0; start < length; start += BLOCK) {
    changes
      .filter(({ at }) => Math.floor(at / BLOCK) * BLOCK === start)
      .forEach((change) => dsp.set(change.params));
    for (let i = 0; i < BLOCK; i++) {
      inL[i] = left(start + i);
      inR[i] = right(start + i);
    }
    dsp.process(inL, inR, L.subarray(start, start + BLOCK), R.subarray(start, start + BLOCK));
  }
  return { L, R };
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

// power of the inharmonic bins against the harmonics of bin k0: what folded back from above the nyquist
const aliasDb = (data: ArrayLike<number>, from: number, k0: number) => {
  const power = spectrum(data, from);
  let harmonics = 0;
  let aliases = 0;
  power.forEach((value, k) => {
    if (k === 0) return;
    if (k % k0 === 0) harmonics += value;
    else aliases += value;
  });
  return db(aliases) - db(harmonics);
};

const maxStep = (data: Float32Array, from: number, to: number) => {
  let max = 0;
  for (let i = from + 1; i < to; i++) max = Math.max(max, Math.abs(data[i] - data[i - 1]));
  return max;
};

const peak = (data: Float32Array, from = 0) => Math.max(...Array.from(data.subarray(from), Math.abs));

const rms = (data: ArrayLike<number>, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (to - from));
};
const toGain = (db: number) => 10 ** (db / 20);

describe('distortion dsp', () => {
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
    for (let i = 2 * DISTORTION_LATENCY; i < 4800; i++) {
      expect(Math.abs(out[i] - input(i - DISTORTION_LATENCY))).toBeLessThan(0.002);
    }
  });

  it('hard clip cuts the peaks of a loud sine at full scale, the makeup gain brings the plateaus down', () => {
    const { L } = render({ drive: 24 }, 9600, sine(500, 0.5));
    const from = 4 * DISTORTION_LATENCY;
    const ceiling = makeupGain(HARD, 24);
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
    [0, 6, 12, 18, 24].forEach((drive) => {
      const { L } = render({ mode, drive }, 2 * N, input);
      // the harmonics above the nyquist are gone, a little of the loudness with them
      expect(Math.abs(20 * Math.log10(rms(L, N, 2 * N) / (REFERENCE_PEAK / Math.SQRT2)))).toBeLessThan(0.3);
    });
  });

  it('a louder sound comes out quieter than it went in, a quieter one louder', () => {
    const k0 = 171;
    const change = (amplitude: number) => {
      const { L } = render({ drive: 24 }, 2 * N, sine(binFreq(k0), amplitude));
      return 20 * Math.log10(rms(L, N, 2 * N) / (amplitude / Math.SQRT2));
    };
    expect(change(1)).toBeLessThan(-5);
    expect(change(0.25)).toBeGreaterThan(5);
  });

  it('soft clip: more drive, more of the 3rd harmonic, the peaks stay below full scale until it squares', () => {
    // 1 kHz on a bin: k0 cycles in N samples
    const k0 = 171;
    const harmonics = [0, 6, 12, 18, 24].map((drive) => {
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
    const { L } = render({ mode, drive: 24 }, 2 * N, sine(binFreq(k0), 0.5));
    const power = spectrum(L, N);
    const fundamental = db(power[k0]);
    expect(db(power[0]) - fundamental).toBeLessThan(-100);
    [2, 4, 6, 8].forEach((n) => expect(db(power[n * k0]) - fundamental).toBeLessThan(-100));
    // the odd ones are there
    expect(db(power[3 * k0]) - fundamental).toBeGreaterThan(-30);
  });

  it.each([
    // a high note hit hard: its harmonics above the nyquist would fold back as inharmonic tones
    { name: 'hard clip of 7 kHz', mode: HARD, k0: 1195, drive: 24, better: 25, below: -40 },
    { name: 'soft clip of 2 kHz', mode: SOFT, k0: 341, drive: 24, better: 30, below: -60 },
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
    const open = spectrum(render({ drive: 24 }, 2 * N, input).L, N);
    const dark = spectrum(render({ drive: 24, tone: 1000 }, 2 * N, input).L, N);
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
    const { L } = render({}, 12000, constant(0.01), {
      changes: [{ at, params: { drive: 12, level: -6 } }],
    });
    const target = 0.01 * toGain(12) * makeupGain(HARD, 12) * toGain(-6);
    expect(L[at - 1]).toBeCloseTo(0.01, 6);
    expect(maxStep(L, at - 1, at + 2000)).toBeLessThan(0.0005);
    expect(L[at + 1]).toBeLessThan(0.0105);
    expect(L[11000]).toBeCloseTo(target, 5);
  });

  it('a new mode crossfades the curves', () => {
    const at = 4096;
    // a constant over the ceiling: tanh(2) on soft clip, 1 on hard clip
    const { L } = render({ mode: SOFT }, 12000, constant(2), { changes: [{ at, params: { mode: HARD } }] });
    expect(L[at - 1]).toBeCloseTo(Math.tanh(2) * makeupGain(SOFT, 0), 6);
    expect(maxStep(L, at - 1, at + 2000)).toBeLessThan(0.0005);
    expect(L[11000]).toBeCloseTo(makeupGain(HARD, 0), 5);
  });

  it('a new mode and a new drive together glide too, each curve with its own makeup', () => {
    const at = 4096;
    const { L } = render({ mode: SOFT, drive: 0 }, 12000, constant(0.1), {
      changes: [{ at, params: { mode: HARD, drive: 24 } }],
    });
    expect(L[at - 1]).toBeCloseTo(Math.tanh(0.1) * makeupGain(SOFT, 0), 6);
    expect(maxStep(L, at - 1, at + 3000)).toBeLessThan(0.002);
    // 0.1 × 24 dB is over the ceiling
    expect(L[11000]).toBeCloseTo(makeupGain(HARD, 24), 5);
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
    const { L } = render({ drive: 12, level: -6 }, 1024, constant(0.01));
    expect(L[2 * DISTORTION_LATENCY]).toBeCloseTo(0.01 * toGain(12) * makeupGain(HARD, 12) * toGain(-6), 6);
  });

  it('a mode out of range takes the nearest one', () => {
    const { L } = render({ mode: 7 }, 1024, constant(2));
    expect(L[1000]).toBeCloseTo(1, 6);
    const { L: soft } = render({ mode: -1 }, 1024, constant(2));
    expect(soft[1000]).toBeCloseTo(Math.tanh(2) * makeupGain(SOFT, 0), 6);
  });

  it('processes the channels on their own', () => {
    const { L, R } = render({ drive: 12 }, 2048, sine(440, 0.5), { right: silence });
    expect(peak(L)).toBeGreaterThan(0.3);
    expect(peak(R)).toBe(0);
  });

  it('after a silence it is cleared and skips the blocks, the next sound starts like in a new one', () => {
    const loud = 2048;
    const quiet = 4096;
    const input: Input = (frame) => {
      if (frame < loud) return sine(440, 0.8)(frame);
      return frame < loud + quiet ? 0 : impulse(0.5)(frame - loud - quiet);
    };
    const { L } = render({ drive: 24, tone: 1000 }, loud + quiet + 512, input);
    L.subarray(loud + 2048, loud + quiet).forEach((value) => expect(value).toBe(0));
    const fresh = render({ drive: 24, tone: 1000 }, 512, impulse(0.5)).L;
    expect(Array.from(L.subarray(loud + quiet))).toEqual(Array.from(fresh));
  });

  it('a change while silent applies at once', () => {
    const quiet = 1024;
    const input: Input = (frame) => (frame < quiet ? 0 : 0.01);
    const { L } = render({}, quiet + 512, input, { changes: [{ at: 0, params: { drive: 12 } }] });
    expect(L[quiet + 2 * DISTORTION_LATENCY]).toBeCloseTo(0.01 * toGain(12) * makeupGain(HARD, 12), 6);
  });
});
