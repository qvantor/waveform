import { number } from '@waveform/math';
import { envelopeCurve, LFO_POINTS_MAX, LfoPoint } from '@waveform/preset-schema';
import { pointsLevel, segmentAt, segmentEnd } from '../common/lfo/lfo-curve';

// the edits of the points of an LFO on its chart (lfo-points.tsx), pure: each gives the new list, or null when
// nothing changes. The points start at x 0 and go up (two at one x: a step), the last segment goes to the first
// point over the end of the cycle (segmentEnd); every list given back is one the model takes (pointsFrom of
// lfos.ts)

// x and y of a point in steps of 0.001
const PRECISION = 1000;

type Points = readonly LfoPoint[];

// point i at (x, y): x within its neighbours (the first one stays at 0, the last one goes up to 1; onto a
// neighbour it makes a step), y within the levels
export const movePoint = (points: Points, i: number, x: number, y: number): LfoPoint[] | null => {
  const [x0, y0, k] = points[i];
  const next: LfoPoint = [
    i === 0 ? 0 : number.thresholds(number.round(x, PRECISION), points[i - 1][0], segmentEnd(points, i)[0]),
    number.thresholds(number.round(y, PRECISION), 0, 1),
    k,
  ];
  if (next[0] === x0 && next[1] === y0) return null;
  return points.map((point, index) => (index === i ? next : point));
};

// the curve of segment j
export const setCurve = (points: Points, j: number, k: number): LfoPoint[] | null => {
  if (points[j][2] === k) return null;
  return points.map((point, index) => (index === j ? [point[0], point[1], k] : point));
};

// point i taken out: not the first one (the cycle starts at it), not below two. The segment before it keeps its
// curve: two curved halves joined are no exponential segment, so nothing exact to keep
export const removePoint = (points: Points, i: number): LfoPoint[] | null => {
  if (i === 0 || points.length <= 2) return null;
  return points.filter((_, index) => index !== i);
};

// a point on the line at x (within the cycle, not at its ends), and its index: on the curve of its segment, which
// keeps its shape: an exponential segment over a part of it is one again, of k times the share of the part
// (e^(-k·x) over [a, b] is e^(-k·a)·e^(-k·(b - a)·u) over the share u of the part, the normalisation cancels), so
// the two parts take k by their shares. Null once there are LFO_POINTS_MAX
export const insertPoint = (points: Points, x: number): { points: LfoPoint[]; index: number } | null => {
  if (points.length >= LFO_POINTS_MAX || !(x > 0 && x < 1)) return null;
  // its end is past x: the next point is, or the end of the cycle
  const j = segmentAt(points, x);
  const [x0, y0, k] = points[j];
  const [x1] = segmentEnd(points, j);
  const share = (x - x0) / (x1 - x0);
  const level = number.round(pointsLevel(points, x), PRECISION);
  return {
    points: [
      ...points.slice(0, j),
      [x0, y0, envelopeCurve(k * share)],
      [number.round(x, PRECISION), level, envelopeCurve(k * (1 - share))],
      ...points.slice(j + 1),
    ],
    index: j + 1,
  };
};

// the spot of the line (its points in px) nearest to (x, y) within `radius` px: the projection on the nearest of
// its segments (a step is a vertical one), or null farther away
export const nearestSpot = (
  line: readonly (readonly [number, number])[],
  x: number,
  y: number,
  radius: number
): [number, number] | null => {
  let best: [number, number] | null = null;
  let distance = radius;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const [dx, dy] = [bx - ax, by - ay];
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : number.thresholds(((x - ax) * dx + (y - ay) * dy) / length, 0, 1);
    const [px, py] = [ax + t * dx, ay + t * dy];
    const d = Math.hypot(x - px, y - py);
    if (d <= distance) {
      distance = d;
      best = [px, py];
    }
  }
  return best;
};
