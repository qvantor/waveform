import { LFO_POINTS_MAX, LFO_SHAPES, normalizePreset } from '@waveform/preset-schema';
import { lfoTable } from '../common/lfo/lfo-curve';
import { CUSTOM_SHAPE, LFO_SHAPE_OPTIONS, shapeOptionOf, shapePoints } from './lfo-shapes';

const OF_POINTS = LFO_SHAPE_OPTIONS.flatMap((option) => ('points' in option ? [option] : []));
const at = (id: string) => OF_POINTS.find((option) => option.id === id)?.points ?? [];
// the level of points at the share x of the cycle
const level = (id: string, x: number) => lfoTable('sine', at(id))[Math.round(x * 2048)];

describe('LFO shapes', () => {
  it('has the shapes of an LFO, then the sidechain, the rhythms and the steps as points', () => {
    expect([...new Set(LFO_SHAPE_OPTIONS.map(({ group }) => group))]).toEqual([
      'Basic',
      'Sidechain',
      'Rhythm',
      'Steps',
    ]);
    expect(LFO_SHAPE_OPTIONS.filter((option) => 'shape' in option).map(({ id }) => id)).toEqual([
      'sine',
      'triangle',
      'saw-up',
      'saw-down',
      'square',
    ]);
    expect(new Set(LFO_SHAPE_OPTIONS.map(({ id }) => id)).size).toBe(LFO_SHAPE_OPTIONS.length);
  });

  it.each(OF_POINTS.map(({ id, points }) => [id, points] as const))(
    '%s: a preset keeps its points, its levels within 0..1',
    (id, points) => {
      expect(points.length).toBeLessThanOrEqual(LFO_POINTS_MAX);
      const saved = normalizePreset({ lfo: { l1: { points } } }).lfo.l1.points;
      expect(saved).toHaveLength(points.length);
      expect(shapeOptionOf({ shape: 'sine', points: saved })).toBe(id);
      expect(lfoTable('sine', points).every((value) => value >= 0 && value <= 1)).toBe(true);
    }
  );

  it('steps between the runs of a gate, no ramp over the end of the cycle', () => {
    // open for the first half of each quarter
    expect([0, 0.1, 0.13, 0.24, 0.25, 0.37, 0.38, 0.99].map((x) => level('gate-4', x))).toEqual([
      1, 1, 0, 0, 1, 1, 0, 0,
    ]);
    // 32 runs: 64 points, the most a preset keeps
    expect(at('gate-16')).toHaveLength(LFO_POINTS_MAX);
  });

  it('drops a pump to 0 at each kick and brings it back to 1, fast at first', () => {
    expect(level('pump', 0)).toBe(0);
    // half its release: over the line
    expect(level('pump', 0.25)).toBeGreaterThan(0.5);
    expect([0.5, 0.99].map((x) => level('pump', x))).toEqual([1, 1]);
    expect([0, 0.25, 0.5, 0.75].map((x) => level('pump-4', x))).toEqual([0, 0, 0, 0]);
    // held at 0, then swells
    expect(level('pump-hard', 0.05)).toBe(0);
    expect(level('pump-hard', 0.275)).toBeLessThan(0.5);
  });

  it.each(LFO_SHAPES.filter((shape) => shape !== 'sine'))('%s as points plays as the shape', (shape) => {
    expect(lfoTable('sine', shapePoints(shape))).toEqual(lfoTable(shape));
  });

  it('a sine as points is four curved quarters within 0.03 of it', () => {
    const points = shapePoints('sine');
    const table = lfoTable('sine', points);
    const sine = lfoTable('sine');
    expect(Math.max(...table.map((level, i) => Math.abs(level - sine[i])))).toBeLessThan(0.03);
    expect(table[0]).toBe(0);
    expect(table[1024]).toBe(1);
  });

  it.each(LFO_SHAPES)('%s as points is Custom, a preset keeps them', (shape) => {
    const points = shapePoints(shape);
    expect(shapeOptionOf({ shape, points: [...points] })).toBe(CUSTOM_SHAPE);
    expect(normalizePreset({ lfo: { l1: { points: [...points] } } }).lfo.l1.points).toEqual(points);
  });

  it('knows the shape of an LFO and points of its own', () => {
    expect(shapeOptionOf({ shape: 'square' })).toBe('square');
    const points: [number, number, number][] = [
      [0, 0, 0],
      [0.3, 1, 2],
    ];
    expect(shapeOptionOf({ shape: 'square', points })).toBe(CUSTOM_SHAPE);
  });
});
