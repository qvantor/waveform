import { createOversampler, OVERSAMPLER_LATENCY, OVERSAMPLING } from './oversampler';

const HALF = OVERSAMPLER_LATENCY / 2;

// the input through up() and down() in blocks of `block` samples, the points untouched
const roundTrip = (input: number[], block = 128, oversampler = createOversampler()) => {
  const output: number[] = [];
  const points = new Float64Array(OVERSAMPLING * block);
  const out = new Float64Array(block);
  for (let start = 0; start < input.length; start += block) {
    const samples = Float64Array.from(input.slice(start, start + block));
    oversampler.up(samples, samples.length, points);
    oversampler.down(points, samples.length, out);
    output.push(...out.subarray(0, samples.length));
  }
  return output;
};

// the points of up() for every sample of the input
const upsample = (input: number[]) => {
  const points = new Float64Array(OVERSAMPLING * input.length);
  createOversampler().up(Float64Array.from(input), input.length, points);
  return points;
};

const impulse = (length: number) => Array.from({ length }, (_, n) => (n === 0 ? 1 : 0));
const sine = (f: number, length: number, phase = 0) =>
  Array.from({ length }, (_, n) => Math.sin(2 * Math.PI * f * n + phase));

// the amplitude of the frequency f (cycles per sample) in values[from..], over whole cycles
const amplitude = (values: number[], f: number, from: number) => {
  const cycles = Math.floor((values.length - from) * f);
  const length = Math.round(cycles / f);
  let re = 0;
  let im = 0;
  for (let n = from; n < from + length; n++) {
    re += values[n] * Math.cos(2 * Math.PI * f * n);
    im += values[n] * Math.sin(2 * Math.PI * f * n);
  }
  return (2 * Math.hypot(re, im)) / length;
};

const db = (gain: number) => 20 * Math.log10(gain);

describe('oversampler', () => {
  it('delays the input by its latency, the impulse response is symmetric around it', () => {
    const output = roundTrip(impulse(128));
    const peak = output.reduce((best, value, n) => (Math.abs(value) > Math.abs(output[best]) ? n : best), 0);
    expect(peak).toBe(OVERSAMPLER_LATENCY);
    for (let k = 1; k <= OVERSAMPLER_LATENCY; k++) {
      expect(output[OVERSAMPLER_LATENCY - k]).toBeCloseTo(output[OVERSAMPLER_LATENCY + k], 12);
    }
    // nothing after the two filters have passed it
    output.slice(2 * OVERSAMPLER_LATENCY + 1).forEach((value) => expect(value).toBe(0));
  });

  it('passes DC exactly', () => {
    const output = roundTrip(Array.from({ length: 200 }, () => 0.7));
    output.slice(2 * OVERSAMPLER_LATENCY).forEach((value) => expect(value).toBeCloseTo(0.7, 12));
  });

  it('point 0 of up() is the sample written half the latency before', () => {
    const input = sine(0.03, 100);
    const points = upsample(input);
    input.forEach((_, n) => expect(points[OVERSAMPLING * n]).toBe(n < HALF ? 0 : input[n - HALF]));
  });

  it('up() interpolates the quarter points between the samples', () => {
    const f = 0.1;
    const points = upsample(sine(f, 200));
    for (let n = 2 * HALF; n < 200; n++) {
      for (let q = 1; q < OVERSAMPLING; q++) {
        const expected = Math.sin(2 * Math.PI * f * (n - HALF + q / OVERSAMPLING));
        expect(Math.abs(points[OVERSAMPLING * n + q] - expected)).toBeLessThan(0.0035);
      }
    }
  });

  it('gives the same in blocks of any size', () => {
    const input = sine(0.07, 1000).map((x, n) => x + (n % 13) / 26);
    const whole = roundTrip(input, 1000);
    [1, 37, 128].forEach((block) => expect(roundTrip(input, block)).toEqual(whole));
  });

  it.each([0.01, 0.1, 0.2, 0.3, 0.4, 0.45])('passes a sine at %p·fs within 0.1 dB, delayed', (f) => {
    const input = sine(f, 4000);
    const output = roundTrip(input);
    expect(Math.abs(db(amplitude(output, f, 2 * OVERSAMPLER_LATENCY)))).toBeLessThan(0.1);
    // linear phase: the delay is the latency at every frequency
    const delayed = sine(f, 4000, -2 * Math.PI * f * OVERSAMPLER_LATENCY);
    for (let n = 2 * OVERSAMPLER_LATENCY; n < 4000; n++) {
      expect(Math.abs(output[n] - delayed[n])).toBeLessThan(0.012);
    }
  });

  it.each([0.6, 0.8, 1.3, 1.7])(
    'suppresses points at %p·fs (over the nyquist) by more than 40 dB instead of folding them back',
    (f) => {
      const frames = 4000;
      const points = Float64Array.from({ length: OVERSAMPLING * frames }, (_, i) =>
        Math.sin((2 * Math.PI * f * i) / OVERSAMPLING)
      );
      const out = new Float64Array(frames);
      createOversampler().down(points, frames, out);
      const output = Array.from(out);
      // the fold of f into the band
      const alias = Math.abs(f - Math.round(f));
      expect(db(amplitude(output, alias, 2 * OVERSAMPLER_LATENCY))).toBeLessThan(-40);
    }
  );

  it('clear forgets the past: the next impulse response is the one of a new oversampler', () => {
    const oversampler = createOversampler();
    roundTrip(sine(0.05, 50), 128, oversampler);
    oversampler.clear();
    expect(roundTrip(impulse(100), 128, oversampler)).toEqual(roundTrip(impulse(100)));
  });
});
