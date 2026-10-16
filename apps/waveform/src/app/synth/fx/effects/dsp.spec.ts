import { biquad } from '@waveform/math';
import {
  createAllpass,
  createBiquad,
  createDcBlocker,
  createDelayLine,
  createFixedAllpass,
  createSmoothed,
  stepAll,
} from './dsp';

const SAMPLE_RATE = 48000;

// the steady-state gain of a sine through `process`: rms out / rms in over whole periods (0.1 s)
const sineGain = (process: (x: number) => number, freq: number) => {
  const n = 4800;
  let input = 0;
  let output = 0;
  for (let i = 0; i < n * 2; i++) {
    const x = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
    const y = process(x);
    if (i >= n) [input, output] = [input + x * x, output + y * y];
  }
  return Math.sqrt(output / input);
};

describe('createDelayLine', () => {
  it('returns the sample written `delay` steps ago', () => {
    const line = createDelayLine(16);
    const out = Array.from({ length: 12 }, (_, i) => {
      const value = line.read(5);
      line.write(i + 1);
      return value;
    });
    expect(out).toEqual([0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('interpolates fractional delays, a ramp stays a ramp', () => {
    const line = createDelayLine(16);
    for (let i = 0; i < 10; i++) line.write(i);
    // the last write (9) is 1 step ago
    expect(line.read(3.5)).toBeCloseTo(6.5, 10);
    expect(line.read(4.25)).toBeCloseTo(5.75, 10);
  });

  it('keeps the highs of a fractional delay (cubic), linear interpolation would dull them', () => {
    const line = createDelayLine(64);
    const gain = sineGain((x) => {
      const y = line.read(10.5);
      line.write(x);
      return y;
    }, 4000);
    // linear: cos(pi · 4000 / 48000) = -0.3 dB per read
    expect(20 * Math.log10(gain)).toBeGreaterThan(-0.05);
  });

  it('wraps around the buffer and clears', () => {
    const line = createDelayLine(4);
    for (let i = 0; i < 100; i++) line.write(i);
    expect(line.read(3)).toBe(97);
    line.clear();
    expect(line.read(3)).toBe(0);
  });

  it('delays at least 2 samples', () => {
    const line = createDelayLine(8);
    [1, 2, 3].forEach((value) => line.write(value));
    expect(line.read(0)).toBe(2);
  });
});

describe('createAllpass', () => {
  it('passes every frequency at unity gain', () => {
    [100, 1000, 7000].forEach((freq) => {
      const allpass = createAllpass(512);
      expect(sineGain((x) => allpass.process(x, 211, 0.6), freq)).toBeCloseTo(1, 2);
    });
  });

  it('smears an impulse: -g at once, then the delayed echoes decaying by g', () => {
    const allpass = createAllpass(16);
    const out = Array.from({ length: 13 }, (_, i) => allpass.process(i === 0 ? 1 : 0, 4, 0.5));
    expect(out[0]).toBe(-0.5);
    expect(out[4]).toBeCloseTo(0.75);
    expect(out[8]).toBeCloseTo(0.375);
    expect(out[12]).toBeCloseTo(0.1875);
    expect(out.filter((_, i) => i % 4)).toEqual(Array(9).fill(0));
  });

  it('clears its state', () => {
    const allpass = createAllpass(16);
    allpass.process(1, 4, 0.5);
    allpass.clear();
    expect(Array.from({ length: 8 }, () => allpass.process(0, 4, 0.5))).toEqual(Array(8).fill(0));
  });
});

describe('createFixedAllpass', () => {
  it('passes every frequency at unity gain, also the highs (no interpolation)', () => {
    [100, 1000, 7000, 18000].forEach((freq) => {
      const allpass = createFixedAllpass(225.6);
      expect(sineGain((x) => allpass.process(x, 0.55), freq)).toBeCloseTo(1, 4);
    });
  });

  it('rounds the delay to whole samples: -g at once, then the echoes decaying by g', () => {
    const allpass = createFixedAllpass(3.6);
    const out = Array.from({ length: 13 }, (_, i) => allpass.process(i === 0 ? 1 : 0, 0.5));
    expect(out[0]).toBe(-0.5);
    expect(out[4]).toBeCloseTo(0.75);
    expect(out[8]).toBeCloseTo(0.375);
    expect(out[12]).toBeCloseTo(0.1875);
    expect(out.filter((_, i) => i % 4)).toEqual(Array(9).fill(0));
  });

  it('clears its state', () => {
    const allpass = createFixedAllpass(4);
    allpass.process(1, 0.5);
    allpass.clear();
    expect(Array.from({ length: 8 }, () => allpass.process(0, 0.5))).toEqual(Array(8).fill(0));
  });
});

describe('createBiquad', () => {
  it.each([
    ['lowpass', { frequency: 1000, Q: -3.01, gain: 0 }, 4000],
    ['highpass', { frequency: 1000, Q: -3.01, gain: 0 }, 300],
    ['peaking', { frequency: 300, Q: 0.7, gain: 6 }, 300],
    ['lowshelf', { frequency: 300, Q: 0, gain: -12 }, 50],
    ['highshelf', { frequency: 6000, Q: 0, gain: -20 }, 12000],
  ] as [BiquadFilterType, biquad.BiquadParams, number][])(
    '%s has the response of BiquadFilterNode',
    (type, params, freq) => {
      const filter = createBiquad();
      filter.set(type, params, SAMPLE_RATE);
      const expected = biquad.magnitudeDb(biquad.coefficients(type, params, SAMPLE_RATE), freq, SAMPLE_RATE);
      expect(20 * Math.log10(sineGain(filter.process, freq))).toBeCloseTo(expected, 1);
    }
  );

  it('passes the signal unchanged before it is set and after a clear', () => {
    const filter = createBiquad();
    expect(filter.process(0.3)).toBe(0.3);
    filter.set('lowpass', { frequency: 100, Q: 0, gain: 0 }, SAMPLE_RATE);
    filter.process(1);
    filter.clear();
    expect(filter.process(0)).toBe(0);
  });

  it('processBlock is process() sample by sample, its state carries on to the next block and to process()', () => {
    const input = Float64Array.from({ length: 300 }, (_, n) => Math.sin(n * 0.3) + (n % 5) / 10);
    const one = createBiquad();
    const block = createBiquad();
    [one, block].forEach((filter) =>
      filter.set('lowpass', { frequency: 2000, Q: -3.01, gain: 0 }, SAMPLE_RATE)
    );
    const expected = Array.from(input, (x) => one.process(x));
    const output = new Float64Array(300);
    block.processBlock(input, output, 128);
    block.processBlock(input.subarray(128), output.subarray(128), 128);
    for (let n = 256; n < 300; n++) output[n] = block.process(input[n]);
    expect(Array.from(output)).toEqual(expected);
  });

  it('clear resets the state of processBlock too', () => {
    const filter = createBiquad();
    filter.set('lowpass', { frequency: 100, Q: 0, gain: 0 }, SAMPLE_RATE);
    const output = new Float64Array(4);
    filter.processBlock(Float64Array.of(1, 1, 1, 1), output, 4);
    filter.clear();
    filter.processBlock(new Float64Array(4), output, 4);
    expect(Array.from(output)).toEqual([0, 0, 0, 0]);
  });
});

describe('createDcBlocker', () => {
  // a sample at a time through processBlock
  const processOf = (blocker: ReturnType<typeof createDcBlocker>) => (x: number) => {
    const data = Float64Array.of(x);
    blocker.processBlock(data, 1);
    return data[0];
  };

  it('takes out the DC: a constant decays to 0', () => {
    const blocker = createDcBlocker(5, SAMPLE_RATE);
    const data = new Float64Array(SAMPLE_RATE).fill(0.5);
    blocker.processBlock(data, data.length);
    expect(data[0]).toBe(0.5);
    expect(Math.abs(data[data.length - 1])).toBeLessThan(1e-6);
  });

  it('leaves the bass alone', () => {
    expect(20 * Math.log10(sineGain(processOf(createDcBlocker(5, SAMPLE_RATE)), 30))).toBeGreaterThan(-0.15);
    // above it lifts a hair: 2 / (1 + r) at the nyquist, +0.003 dB
    expect(
      Math.abs(20 * Math.log10(sineGain(processOf(createDcBlocker(5, SAMPLE_RATE)), 1000)))
    ).toBeLessThan(0.01);
  });

  it('a block is the samples one by one, its state carries on to the next block', () => {
    const input = Float64Array.from({ length: 300 }, (_, n) => Math.sin(n * 0.3) + 0.2);
    const one = createDcBlocker(5, SAMPLE_RATE);
    const expected = Array.from(input, processOf(one));
    const block = createDcBlocker(5, SAMPLE_RATE);
    const data = Float64Array.from(input);
    block.processBlock(data, 128);
    block.processBlock(data.subarray(128), 172);
    expect(Array.from(data)).toEqual(expected);
  });

  it('clear resets its state', () => {
    const blocker = createDcBlocker(5, SAMPLE_RATE);
    blocker.processBlock(Float64Array.of(1, 1, 1, 1), 4);
    blocker.clear();
    const data = new Float64Array(4);
    blocker.processBlock(data, 4);
    expect(Array.from(data)).toEqual([0, 0, 0, 0]);
  });
});

describe('createSmoothed', () => {
  it('glides to the target with the time constant, `from` is the value at the block start', () => {
    const value = createSmoothed(0, 0.01, SAMPLE_RATE);
    value.set(1);
    // one time constant: 480 frames
    expect(value.step(480)).toBe(true);
    expect(value.from).toBe(0);
    expect(value.value).toBeCloseTo(1 - Math.exp(-1));
    value.step(480);
    expect(value.from).toBeCloseTo(1 - Math.exp(-1));
  });

  it('reaches the target exactly and then stays', () => {
    const value = createSmoothed(0, 0.001, SAMPLE_RATE);
    value.set(2);
    for (let i = 0; i < 100; i++) value.step(128);
    expect(value.value).toBe(2);
    expect(value.step(128)).toBe(false);
    expect(value.from).toBe(2);
  });

  it('jumps on an instant set and on snap', () => {
    const value = createSmoothed(0, 1, SAMPLE_RATE);
    value.set(3, true);
    expect([value.from, value.value]).toEqual([3, 3]);
    value.set(5);
    value.snap();
    expect([value.from, value.value]).toEqual([5, 5]);
    expect(value.step(128)).toBe(false);
  });
});

describe('stepAll', () => {
  it('steps every value, true while any of them glides', () => {
    const values = [createSmoothed(0, 0.01, SAMPLE_RATE), createSmoothed(1, 0.01, SAMPLE_RATE)];
    expect(stepAll(values, 128)).toBe(false);
    values[1].set(2);
    expect(stepAll(values, 128)).toBe(true);
    expect(values[1].value).toBeGreaterThan(1);
    expect(values[0].from).toBe(0);
    values[1].snap();
    expect(stepAll(values, 128)).toBe(false);
  });
});
