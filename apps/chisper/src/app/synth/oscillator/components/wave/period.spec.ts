import { periodCapacity, periodPoints } from './period';

const points = (wave: number[], columns: number) => {
  const xs = new Float64Array(periodCapacity(columns));
  const ys = new Float64Array(xs.length);
  const count = periodPoints(wave, columns, xs, ys);
  return Array.from({ length: count }, (_, i) => [xs[i], ys[i]]);
};

describe('periodPoints', () => {
  it('draws every sample while there are at most 2 per column, closed by zeros and the first sample', () => {
    expect(points([0, 1, 0, -1], 400)).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 0],
      [4, -1],
      [5, 0],
      [6, 0],
    ]);
    expect(points([], 400)).toEqual([]);
  });

  it('draws the lowest and the highest sample of each column in their order past 2 per column', () => {
    // a saw with a sine on it: 2048 samples into 400 px
    const wave = Array.from({ length: 2048 }, (_, i) => i / 1024 - 1 + 0.1 * Math.sin(i * 0.9));
    const drawn = points(wave, 400);
    expect(drawn.length).toBeLessThanOrEqual(2 * 400 + 3);
    expect(drawn.length).toBeGreaterThan(400);
    expect(drawn.slice(-2)).toEqual([
      [2049, wave[0]],
      [2050, 0],
    ]);
    const xs = drawn.slice(1, -2).map(([x]) => x - 1);
    // in the order of the samples, each one where it is
    xs.forEach((x, i) => {
      if (i > 0) expect(x).toBeGreaterThan(xs[i - 1]);
      expect(drawn[i + 1][1]).toBe(wave[x]);
    });
    // every column keeps its extremes
    for (let column = 0; column < 400; column++) {
      const samples = wave
        .map((value, i) => ({ value, i }))
        .filter(({ i }) => Math.floor((i * 400) / 2048) === column);
      const values = samples.map(({ value }) => value);
      const kept = xs.filter((x) => Math.floor((x * 400) / 2048) === column).map((x) => wave[x]);
      expect(Math.min(...kept)).toBe(Math.min(...values));
      expect(Math.max(...kept)).toBe(Math.max(...values));
    }
  });
});
