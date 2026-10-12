import { getBaseLog, getLogOfTwo, percent, powerOfTwo, round, thresholds } from './number';

describe('number', () => {
  it('clamps value into [min, max]', () => {
    expect(thresholds(5, 0, 10)).toBe(5);
    expect(thresholds(-1, 0, 10)).toBe(0);
    expect(thresholds(11, 0, 10)).toBe(10);
    expect(thresholds(0, 0, 0)).toBe(0);
  });

  it('computes logarithms by base', () => {
    expect(getBaseLog(10, 1000)).toBeCloseTo(3);
    expect(getLogOfTwo(1024)).toBeCloseTo(10);
    expect(getLogOfTwo(1)).toBe(0);
  });

  it('rounds with precision', () => {
    expect(round(1.23456)).toBe(1.235);
    expect(round(1.23456, 10)).toBe(1.2);
    expect(round(-0.0004)).toBe(-0);
  });

  it('formats percent', () => {
    expect(percent(0.5)).toBe('50%');
    expect(percent(0.123)).toBe('12%');
    expect(percent(1)).toBe('100%');
  });

  it('raises two to the power', () => {
    expect(powerOfTwo(0)).toBe(1);
    expect(powerOfTwo(11)).toBe(2048);
    expect(powerOfTwo(-1)).toBe(0.5);
    expect(powerOfTwo(getLogOfTwo(300))).toBeCloseTo(300);
  });
});
