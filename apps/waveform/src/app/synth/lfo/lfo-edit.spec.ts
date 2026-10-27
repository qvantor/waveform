import { LFO_POINTS_MAX, LfoPoint } from '@waveform/preset-schema';
import { lfoTable } from '../common/lfo/lfo-curve';
import { LFO_SHAPE_OPTIONS } from './lfo-shapes';
import { insertPoint, movePoint, nearestSpot, removePoint, setCurve } from './lfo-edit';

// a curved rise to 0.5, a line down to 0.2, a step to 0 at 0.6, then the wrap to 0 at 1
const points: LfoPoint[] = [
  [0, 0, 3],
  [0.4, 1, 0],
  [0.6, 0.2, -2],
  [0.6, 0, 0],
];

const gate16 = LFO_SHAPE_OPTIONS.flatMap((option) =>
  'points' in option && option.id === 'gate-16' ? option.points : []
);

describe('movePoint', () => {
  it('moves a point within its neighbours and the levels, to 0.001', () => {
    expect(movePoint(points, 1, 0.12345, 0.5)).toEqual([points[0], [0.123, 0.5, 0], points[2], points[3]]);
    expect(movePoint(points, 1, 0.9, 1.5)?.[1]).toEqual([0.6, 1, 0]);
    expect(movePoint(points, 1, -1, -1)?.[1]).toEqual([0, 0, 0]);
  });

  it('keeps the first point at x 0, the last one goes up to 1', () => {
    expect(movePoint(points, 0, 0.3, 0.5)?.[0]).toEqual([0, 0.5, 3]);
    expect(movePoint(points, 3, 2, 0)?.[3]).toEqual([1, 0, 0]);
  });

  it('is nothing where the point is', () => {
    expect(movePoint(points, 1, 0.4, 1)).toBeNull();
    expect(movePoint(points, 0, 0.5, 0)).toBeNull();
    // clamped onto its own place
    expect(movePoint(points, 3, 0.5, 0)).toBeNull();
  });
});

describe('setCurve', () => {
  it('curves a segment, nothing at its k', () => {
    expect(setCurve(points, 1, 1.5)?.[1]).toEqual([0.4, 1, 1.5]);
    expect(setCurve(points, 0, 3)).toBeNull();
  });
});

describe('removePoint', () => {
  it('takes a point out, not the first one, not below two', () => {
    expect(removePoint(points, 2)).toEqual([points[0], points[1], points[3]]);
    expect(removePoint(points, 0)).toBeNull();
    expect(removePoint([points[0], points[1]], 1)).toBeNull();
  });
});

describe('insertPoint', () => {
  it('adds a point on the line, the curve of its segment kept by the shares of the parts', () => {
    const next = insertPoint(points, 0.1);
    expect(next).toEqual({
      points: [[0, 0, 0.75], [0.1, 0.555, 2.25], points[1], points[2], points[3]],
      index: 1,
    });
    const [before, after] = [lfoTable('sine', points), lfoTable('sine', next?.points ?? [])];
    // the same table but for the roundings of the level and the k
    expect(Math.max(...before.map((level, i) => Math.abs(level - after[i])))).toBeLessThan(2e-3);
  });

  it('splits a line into two lines', () => {
    expect(insertPoint(points, 0.5)?.points.slice(1, 3)).toEqual([
      [0.4, 1, 0],
      [0.5, 0.6, 0],
    ]);
  });

  it('adds a point on the segment to the end of the cycle after the last one', () => {
    const next = insertPoint(points, 0.8);
    expect(next?.points.slice(3)).toEqual([
      [0.6, 0, 0],
      [0.8, 0, 0],
    ]);
    expect(next?.index).toBe(4);
  });

  it('adds none at the ends of the cycle, nor to LFO_POINTS_MAX points', () => {
    expect(insertPoint(points, 0)).toBeNull();
    expect(insertPoint(points, 1)).toBeNull();
    expect(gate16).toHaveLength(LFO_POINTS_MAX);
    expect(insertPoint(gate16, 0.01)).toBeNull();
  });
});

describe('nearestSpot', () => {
  // a line up to (100, 100), a step down to (100, 0), a line on to (200, 0)
  const line: [number, number][] = [
    [0, 0],
    [100, 100],
    [100, 0],
    [200, 0],
  ];

  it('is the projection on the nearest segment within the radius', () => {
    expect(nearestSpot(line, 52, 48, 6)).toEqual([50, 50]);
    expect(nearestSpot(line, 104, 30, 6)).toEqual([100, 30]);
    expect(nearestSpot(line, 150, 5, 6)).toEqual([150, 0]);
    expect(nearestSpot(line, 150, 7, 6)).toBeNull();
    // past the ends
    expect(nearestSpot(line, 203, 2, 6)).toEqual([200, 0]);
  });
});
