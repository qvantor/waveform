import { FX_PARAMS } from '@waveform/preset-schema';
import { DISTORTION_MODES, modeIndex } from './distortion-modes';

const [SOFT, HARD] = DISTORTION_MODES;
const XS = Array.from({ length: 161 }, (_, i) => (i - 80) / 10);

describe('distortion modes', () => {
  it('soft clip and hard clip, with unique ids', () => {
    expect(DISTORTION_MODES.map(({ id }) => id)).toEqual(['soft', 'hard']);
    expect(DISTORTION_MODES.map(({ label }) => label)).toEqual(['Soft clip', 'Hard clip']);
  });

  it('the mode param covers every mode', () => {
    expect(FX_PARAMS.distortion.mode).toMatchObject({ min: 0, max: DISTORTION_MODES.length - 1, int: true });
  });

  it.each(DISTORTION_MODES)(
    '$label is odd, within ±1, and passes quiet signals with the slope 1',
    ({ shape }) => {
      expect(shape(0)).toBe(0);
      XS.forEach((x) => {
        expect(shape(-x)).toBeCloseTo(-shape(x), 15);
        expect(Math.abs(shape(x))).toBeLessThanOrEqual(1);
      });
      expect(shape(1e-4) / 1e-4).toBeCloseTo(1, 6);
    }
  );

  it('soft clip is tanh: it bends before full scale and never reaches it', () => {
    XS.forEach((x) => expect(SOFT.shape(x)).toBe(Math.tanh(x)));
    expect(SOFT.shape(0.5)).toBeLessThan(0.5);
    expect(SOFT.shape(8)).toBeLessThan(1);
  });

  it('hard clip passes everything within ±1 and cuts the rest', () => {
    expect(HARD.shape(0.5)).toBe(0.5);
    expect(HARD.shape(-1)).toBe(-1);
    expect(HARD.shape(1.5)).toBe(1);
    expect(HARD.shape(-8)).toBe(-1);
  });

  it.each(DISTORTION_MODES)(
    '$label: shapeBlock is the curve × the gains, added when asked',
    ({ shape, shapeBlock }) => {
      const length = XS.length;
      const points = Float64Array.from(XS);
      const gains = Float64Array.from(XS, (_, i) => 0.25 + (i % 7) / 4);
      const out = new Float64Array(length + 2).fill(9);
      shapeBlock(points, gains, length, out, false);
      XS.forEach((x, i) => expect(out[i]).toBe(shape(x) * gains[i]));
      // only `length` points are written
      expect(Array.from(out.subarray(length))).toEqual([9, 9]);
      const base = Float64Array.from(XS, (_, i) => i / 10);
      const sum = Float64Array.from(base);
      shapeBlock(points, gains, length, sum, true);
      XS.forEach((x, i) => expect(sum[i]).toBe(base[i] + shape(x) * gains[i]));
    }
  );

  it('modeIndex rounds and clamps the param', () => {
    expect(modeIndex(0)).toBe(0);
    expect(modeIndex(0.4)).toBe(0);
    expect(modeIndex(0.6)).toBe(1);
    expect(modeIndex(-1)).toBe(0);
    expect(modeIndex(7)).toBe(DISTORTION_MODES.length - 1);
  });
});
