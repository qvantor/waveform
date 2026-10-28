import { LfoPoint, LfoShape } from '@waveform/preset-schema';
import type { LfoParams } from '../common/modules/lfos';

// the shapes the LFO section offers, by category: the shapes of an LFO (Basic) and points of its own (the others:
// the preset keeps the points, a change of this list doesn't change a sound). Levels 0..1, the left point is the
// level of the cycle at its start (and during Delay); a sidechain shape is 0 at the kick and back at 1 after it, a
// gate 1 while it lets through
export type LfoShapeGroup = 'Basic' | 'Sidechain' | 'Rhythm' | 'Steps';

export type LfoShapeOption = { id: string; name: string; group: LfoShapeGroup } & (
  | { shape: LfoShape }
  | { points: LfoPoint[] }
);

// points of its own that are none of the list (a preset made by hand)
export const CUSTOM_SHAPE = 'custom';

// a step is two points at one x; the last segment of the points goes to the first one over the end of the cycle,
// so each run of a level ends in a point of its own (the last at 1): no ramp between the runs
const runPoints = (runs: [number, number][]) =>
  runs.flatMap(([x, level], i): LfoPoint[] => [
    [x, level, 0],
    [i + 1 < runs.length ? runs[i + 1][0] : 1, level, 0],
  ]);

// the cycle in equal steps of `levels`, each held for `duty` of its step and 0 after it (a gate); a level as the
// one before goes on
const stepPoints = (levels: number[], duty = 1) => {
  const runs: [number, number][] = [];
  const run = (x: number, level: number) => {
    if (runs.length === 0 || runs[runs.length - 1][1] !== level) runs.push([x, level]);
  };
  levels.forEach((level, i) => {
    run(i / levels.length, level);
    if (duty < 1) run((i + duty) / levels.length, 0);
  });
  return runPoints(runs);
};

// a gate of `pattern` (1 open, 0 closed), each step open for `duty` of it
const gatePoints = (pattern: string, duty = 1) => stepPoints([...pattern].map(Number), duty);

// `count` kicks a cycle: at each the level drops to 0, stays there `hold`, then comes back to 1 in `release` on a
// curve of k (shares of the span of a kick)
const pumpPoints = (count: number, hold: number, release: number, k: number) =>
  Array.from({ length: count }, (_, i): LfoPoint[] => {
    const [x, span] = [i / count, 1 / count];
    return [
      ...(hold > 0 ? [[x, 0, 0] as LfoPoint] : []),
      [x + hold * span, 0, k],
      [x + (hold + release) * span, 1, 0],
      [x + span, 1, 0],
    ];
  }).flat();

// `count` hits a cycle: at each the level jumps to 1 and falls to 0 in `decay` on a curve of k (shares of the span
// of a hit)
const pluckPoints = (count: number, decay: number, k: number) =>
  Array.from({ length: count }, (_, i): LfoPoint[] => {
    const [x, span] = [i / count, 1 / count];
    return [
      [x, 1, k],
      [x + decay * span, 0, 0],
      [x + span, 0, 0],
    ];
  }).flat();

export const LFO_SHAPE_OPTIONS: LfoShapeOption[] = [
  { id: 'sine', name: 'Sine', group: 'Basic', shape: 'sine' },
  { id: 'triangle', name: 'Triangle', group: 'Basic', shape: 'triangle' },
  { id: 'saw-up', name: 'Saw up', group: 'Basic', shape: 'saw-up' },
  { id: 'saw-down', name: 'Saw down', group: 'Basic', shape: 'saw-down' },
  { id: 'square', name: 'Square', group: 'Basic', shape: 'square' },

  { id: 'pump', name: 'Pump', group: 'Sidechain', points: pumpPoints(1, 0, 0.5, 2) },
  { id: 'pump-soft', name: 'Pump soft', group: 'Sidechain', points: pumpPoints(1, 0, 0.8, 1) },
  { id: 'pump-hard', name: 'Pump hard', group: 'Sidechain', points: pumpPoints(1, 0.1, 0.35, -2) },
  { id: 'pump-2', name: 'Pump ×2', group: 'Sidechain', points: pumpPoints(2, 0, 0.5, 2) },
  { id: 'pump-4', name: 'Pump ×4', group: 'Sidechain', points: pumpPoints(4, 0, 0.5, 2) },
  { id: 'kick', name: 'Kick', group: 'Sidechain', points: pluckPoints(1, 0.5, 4) },

  { id: 'gate-4', name: 'Gate ×4', group: 'Rhythm', points: gatePoints('1111', 0.5) },
  { id: 'gate-8', name: 'Gate ×8', group: 'Rhythm', points: gatePoints('11111111', 0.5) },
  { id: 'gate-16', name: 'Gate ×16', group: 'Rhythm', points: gatePoints('1111111111111111', 0.5) },
  { id: 'offbeat', name: 'Offbeat', group: 'Rhythm', points: gatePoints('01010101', 0.75) },
  { id: 'dotted', name: 'Dotted 3-3-2', group: 'Rhythm', points: gatePoints('11011010') },
  { id: 'trance-a', name: 'Trance A', group: 'Rhythm', points: gatePoints('1101101101101101', 0.75) },
  { id: 'trance-b', name: 'Trance B', group: 'Rhythm', points: gatePoints('1010111010101110', 0.75) },
  {
    id: 'stutter',
    name: 'Stutter',
    group: 'Rhythm',
    points: gatePoints('10101010111111111111111111111111'),
  },
  { id: 'pluck-4', name: 'Pluck ×4', group: 'Rhythm', points: pluckPoints(4, 0.6, 4) },

  { id: 'steps-up', name: 'Up ×4', group: 'Steps', points: stepPoints([0, 1 / 3, 2 / 3, 1]) },
  { id: 'steps-down', name: 'Down ×4', group: 'Steps', points: stepPoints([1, 2 / 3, 1 / 3, 0]) },
  {
    id: 'steps-up-down',
    name: 'Up-down',
    group: 'Steps',
    points: stepPoints([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25]),
  },
  {
    id: 'steps-random',
    name: 'Random ×8',
    group: 'Steps',
    points: stepPoints([0.6, 0.15, 0.9, 0.35, 0.75, 0, 0.5, 0.25]),
  },
];

// the k of the quarters of a sine: each quarter of (1 - cos 2πx) / 2 as one curved segment (the rising half convex
// then concave, the falling half the same way); 1.7 keeps the table within 0.022 of the sine
const SINE_K = 1.7;
// the shapes of an LFO as points: what the editor shows and edits (Custom from the first change on). The table
// never reads x 1: a point there ends the last segment, no wrap to the first one
const BASIC_POINTS: Record<LfoShape, readonly LfoPoint[]> = {
  sine: [
    [0, 0, -SINE_K],
    [0.25, 0.5, SINE_K],
    [0.5, 1, -SINE_K],
    [0.75, 0.5, SINE_K],
  ],
  triangle: [
    [0, 0, 0],
    [0.5, 1, 0],
  ],
  'saw-up': [
    [0, 0, 0],
    [1, 1, 0],
  ],
  'saw-down': [
    [0, 1, 0],
    [1, 0, 0],
  ],
  square: runPoints([
    [0, 1],
    [0.5, 0],
  ]),
};
export const shapePoints = (shape: LfoShape) => BASIC_POINTS[shape];

// a preset keeps 4 significant digits: its points are those of a shape of the list within this
const TOLERANCE = 1e-4;

const samePoints = (a: readonly LfoPoint[], b: readonly LfoPoint[]) =>
  a.length === b.length &&
  a.every((point, i) => point.every((value, j) => Math.abs(value - b[i][j]) <= TOLERANCE));

// the id of the shape of the list an LFO plays (CUSTOM_SHAPE: points of its own that are none of them)
export const shapeOptionOf = ({ shape, points }: Pick<LfoParams, 'shape' | 'points'>) => {
  if (!points) return shape;
  const option = LFO_SHAPE_OPTIONS.find((option) => 'points' in option && samePoints(option.points, points));
  return option?.id ?? CUSTOM_SHAPE;
};
