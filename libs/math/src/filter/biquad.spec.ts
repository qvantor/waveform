import { coefficients, magnitudeDb } from './biquad';

const SAMPLE_RATE = 48000;
const params = { frequency: 1000, Q: 0, gain: 0 };
const db = (type: BiquadFilterType, props: Partial<typeof params>, freq: number) =>
  magnitudeDb(coefficients(type, { ...params, ...props }, SAMPLE_RATE), freq, SAMPLE_RATE);

describe('biquad coefficients', () => {
  it('are normalized to a0 = 1', () => {
    const [b0, b1, b2, a1, a2] = coefficients('lowpass', params, SAMPLE_RATE);
    const w0 = (2 * Math.PI * 1000) / SAMPLE_RATE;
    const alpha = Math.sin(w0) / 2;
    expect(b0).toBeCloseTo((1 - Math.cos(w0)) / 2 / (1 + alpha), 12);
    expect(b1).toBeCloseTo(2 * b0, 12);
    expect(b2).toBeCloseTo(b0, 12);
    expect(a1).toBeCloseTo((-2 * Math.cos(w0)) / (1 + alpha), 12);
    expect(a2).toBeCloseTo((1 - alpha) / (1 + alpha), 12);
  });

  it('take Q in dB for lowpass and highpass, linear for peaking', () => {
    expect(db('lowpass', { Q: 12 }, 1000)).toBeCloseTo(12, 5);
    expect(db('highpass', { Q: -3.01 }, 1000)).toBeCloseTo(-3.01, 5);
    expect(db('peaking', { Q: 2, gain: 6 }, 1000)).toBeCloseTo(6, 5);
  });

  it('shelves (S = 1) have half the gain at the cutoff and the full gain on their side', () => {
    expect(db('lowshelf', { gain: -12 }, 1000)).toBeCloseTo(-6, 5);
    expect(db('lowshelf', { gain: -12 }, 10)).toBeCloseTo(-12, 1);
    expect(db('highshelf', { gain: 8 }, 1000)).toBeCloseTo(4, 5);
    expect(db('highshelf', { gain: 8 }, 23000)).toBeCloseTo(8, 1);
  });

  it('follow the browsers at nyquist and 0 Hz', () => {
    expect(coefficients('lowpass', { ...params, frequency: 24000 }, SAMPLE_RATE)).toEqual([1, 0, 0, 0, 0]);
    expect(coefficients('lowpass', { ...params, frequency: 30000 }, SAMPLE_RATE)).toEqual([1, 0, 0, 0, 0]);
    expect(coefficients('highpass', { ...params, frequency: 0 }, SAMPLE_RATE)).toEqual([1, 0, 0, 0, 0]);
    const [gain] = coefficients('highshelf', { ...params, frequency: 0, gain: 6 }, SAMPLE_RATE);
    expect(20 * Math.log10(gain)).toBeCloseTo(6, 10);
    expect(coefficients('peaking', { ...params, Q: 0, gain: 6 }, SAMPLE_RATE)[0]).toBeCloseTo(
      10 ** (6 / 20),
      10
    );
  });
});
