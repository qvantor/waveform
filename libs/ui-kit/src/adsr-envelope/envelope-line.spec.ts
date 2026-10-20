import { CURVE_POINTS, envelopeLine } from './index';

const stages = { attack: 0.1, hold: 0.2, decay: 0.4, sustain: 0.5, release: 1 };

describe('envelopeLine', () => {
  it('draws a linear envelope by its corners', () => {
    const { corners, points } = envelopeLine(stages);
    expect(corners).toEqual([
      [0, 0],
      [0.1, 1],
      [expect.closeTo(0.3, 12), 1],
      [expect.closeTo(0.7, 12), 0.5],
      [expect.closeTo(1.7, 12), 0],
    ]);
    expect(points).toEqual(corners);
  });

  it('draws a curved stage in CURVE_POINTS points of its curve, the corners where they were', () => {
    const k = 3.49;
    const shape = (x: number) => (1 - Math.exp(-k * x)) / (1 - Math.exp(-k));
    const { corners, points } = envelopeLine(stages, { attack: 0, decay: k, release: k });
    expect(corners).toHaveLength(5);
    expect(points).toHaveLength(5 + 2 * (CURVE_POINTS - 1));
    corners.forEach((corner) => expect(points).toContainEqual(corner));
    // the decay: from (0.3, 1) to (0.7, 0.5), fast at first
    const decay = points.filter(([x]) => x > 0.3 + 1e-9 && x < 0.7 - 1e-9);
    expect(decay).toHaveLength(CURVE_POINTS - 1);
    decay.forEach(([x, y]) => expect(y).toBeCloseTo(1 - 0.5 * shape((x - 0.3) / 0.4), 12));
    expect(decay[0][1]).toBeLessThan(1 - 0.5 / CURVE_POINTS);
  });
});
