export interface LineProps {
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
}

// the curvature of the attack, the decay and the release: k of (1 - e^(-k·x)) / (1 - e^(-k)) over the share x of
// the stage, 0 a line (the envelope-curve.ts of the app)
export interface AdsrCurves {
  attack: number;
  decay: number;
  release: number;
}
// every stage a line
export const LINEAR_CURVES: AdsrCurves = { attack: 0, decay: 0, release: 0 };
export const curveShape = (k: number, x: number) =>
  k === 0 ? x : (1 - Math.exp(-k * x)) / (1 - Math.exp(-k));
// the points of a curved stage (a line has its corners alone)
export const CURVE_POINTS = 32;

// the line of an envelope from its corners: a curved stage from one to the next in CURVE_POINTS points
export const envelopeLine = (
  { attack, hold, decay, sustain, release }: LineProps,
  curves: AdsrCurves = LINEAR_CURVES
) => {
  const corners: [number, number][] = [
    [0, 0],
    [attack, 1],
    [attack + hold, 1],
    [attack + hold + decay, sustain],
    [attack + hold + decay + release, 0],
  ];
  const ks = [curves.attack, 0, curves.decay, curves.release];
  const points: [number, number][] = [corners[0]];
  ks.forEach((k, stage) => {
    const [[x0, y0], [x1, y1]] = [corners[stage], corners[stage + 1]];
    if (k !== 0)
      for (let i = 1; i < CURVE_POINTS; i++)
        points.push([x0 + ((x1 - x0) * i) / CURVE_POINTS, y0 + (y1 - y0) * curveShape(k, i / CURVE_POINTS)]);
    points.push(corners[stage + 1]);
  });
  return { corners, points };
};
