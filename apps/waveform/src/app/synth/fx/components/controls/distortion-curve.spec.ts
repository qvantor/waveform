import { CURVE_POINTS, curveInput, transferCurve } from './distortion-curve';

const SOFT = 0;
const HARD = 1;
const CENTER = (CURVE_POINTS - 1) / 2;

describe('transferCurve', () => {
  it('spans the input from -1 to 1 in CURVE_POINTS points', () => {
    expect(transferCurve(SOFT, 0)).toHaveLength(CURVE_POINTS);
    expect(curveInput(0)).toBe(-1);
    expect(curveInput(CENTER)).toBe(0);
    expect(curveInput(CURVE_POINTS - 1)).toBe(1);
  });

  it('hard clip without drive is the dry diagonal, with drive it cuts at ±1', () => {
    transferCurve(HARD, 0).forEach((y, i) => expect(y).toBeCloseTo(curveInput(i), 12));
    const driven = transferCurve(HARD, 12);
    expect(Math.max(...driven)).toBe(1);
    expect(Math.min(...driven)).toBe(-1);
    // ×3.98: within ±1/4 of the input the curve is still straight
    const i = CENTER + 7;
    expect(driven[i]).toBeCloseTo(10 ** (12 / 20) * curveInput(i), 12);
  });

  it('soft clip is tanh of the driven input', () => {
    transferCurve(SOFT, 6).forEach((y, i) =>
      expect(y).toBeCloseTo(Math.tanh(10 ** (6 / 20) * curveInput(i)), 12)
    );
  });

  it('stays within ±1 at every drive, so it always fits the chart', () => {
    [SOFT, HARD].forEach((mode) =>
      [0, 6, 12, 18].forEach((drive) =>
        transferCurve(mode, drive).forEach((y) => expect(Math.abs(y)).toBeLessThanOrEqual(1))
      )
    );
  });

  it('is odd and rises with the input', () => {
    [SOFT, HARD].forEach((mode) => {
      const curve = transferCurve(mode, 18);
      curve.forEach((y, i) => {
        expect(y).toBeCloseTo(-curve[CURVE_POINTS - 1 - i], 12);
        if (i > 0) expect(y).toBeGreaterThanOrEqual(curve[i - 1]);
      });
    });
  });

  it('more drive bends it earlier', () => {
    const quarter = (CURVE_POINTS - 1) * 0.625;
    expect(transferCurve(SOFT, 18)[quarter]).toBeGreaterThan(transferCurve(SOFT, 6)[quarter]);
  });

  it('a mode out of range takes the nearest one', () => {
    expect(transferCurve(9, 12)).toEqual(transferCurve(HARD, 12));
  });
});
