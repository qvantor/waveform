import { createOnsetDetector } from './probe-dsp';

// a block of 128 samples, silent but at the given indexes
const block = (samples: Record<number, number> = {}) => {
  const values = new Float32Array(128);
  Object.entries(samples).forEach(([index, value]) => (values[Number(index)] = value));
  return values;
};

describe('onset detector', () => {
  it('finds the first sample over the threshold after silence', () => {
    const detect = createOnsetDetector({ threshold: 0.1, quiet: 4 });
    expect(detect([block({ 40: 0.2, 41: 0.5 })], 128)).toBe(40);
  });

  it('takes a sample at the threshold for silence', () => {
    // (0.25: the same as a float32)
    const detect = createOnsetDetector({ threshold: 0.25, quiet: 4 });
    expect(detect([block({ 10: 0.25, 11: -0.25 })], 128)).toBe(-1);
    expect(detect([block({ 12: -0.3 })], 128)).toBe(12);
  });

  it('hears any channel', () => {
    const detect = createOnsetDetector({ threshold: 0.1, quiet: 4 });
    expect(detect([block(), block({ 7: -0.3 })], 128)).toBe(7);
  });

  it('finds no new onset in a sound that goes on, until it was quiet long enough, across blocks', () => {
    const detect = createOnsetDetector({ threshold: 0.1, quiet: 200 });
    const loud = Float32Array.from({ length: 128 }, () => 0.5);
    expect(detect([loud], 128)).toBe(0);
    expect(detect([loud], 128)).toBe(-1);
    // 128 + 100 quiet samples: not enough, then 128 more: enough
    expect(detect([block({ 100: 0.5 })], 128)).toBe(-1);
    expect(detect([block()], 128)).toBe(-1);
    expect(detect([block({ 120: 0.5 })], 128)).toBe(120);
  });

  it('takes a disconnected input for silence', () => {
    const detect = createOnsetDetector({ threshold: 0.1, quiet: 200 });
    expect(detect([block({ 0: 1 })], 128)).toBe(0);
    expect(detect([], 128)).toBe(-1);
    expect(detect([], 128)).toBe(-1);
    expect(detect([block({ 5: 1 })], 128)).toBe(5);
  });
});
