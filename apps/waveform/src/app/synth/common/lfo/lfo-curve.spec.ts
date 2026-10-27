import { curveShape } from '../envelope/envelope-curve';
import {
  createLfoGlobal,
  createLfoRunner,
  FREE,
  frac,
  LFO_GLIDE,
  LFO_SEGMENT,
  LFO_TABLE_SIZE,
  LfoGlobal,
  lfoTable,
  lfoTableFrom,
  LfoWire,
  nextAnchor,
  phaseAt,
  RETRIG,
  tableLevel,
} from './lfo-curve';

const RATE = 48000;

const wire = (change: Partial<LfoWire> = {}): LfoWire => ({
  mode: RETRIG,
  delay: 0,
  rise: 0,
  smooth: 0,
  phase: 0,
  anchor: { time: 0, phase: 0, period: 0.5 },
  ...change,
});

// an LFO of `change` from 0 on, a sine by default
const lfoOf = (change: Partial<LfoWire> = {}) => {
  const lfo = createLfoGlobal();
  lfo.set(0, wire(change), true);
  return lfo;
};

// the levels of a runner at the points of blocks of 128 from frame `from` to `to`, as a voice works them out
const pointsOf = (
  lfo: LfoGlobal,
  start: number,
  from: number,
  to: number,
  runner = createLfoRunner(RATE)
) => {
  runner.start(start);
  const levels: [number, number][] = [];
  for (let block = from; block < to; block += 128) {
    for (let p = 0; ; p = Math.min(p + LFO_SEGMENT, 127)) {
      levels.push([block + p, runner.point(block + p, lfo)]);
      if (p === 127) break;
    }
  }
  return levels;
};

const sine = (x: number) => (1 - Math.cos(2 * Math.PI * x)) / 2;

describe('lfoTable', () => {
  it('has a cycle of each shape and its first level again at the end', () => {
    const at = (table: Float32Array, x: number) => table[Math.round(x * LFO_TABLE_SIZE)];
    const sineTable = lfoTable('sine');
    expect(sineTable).toHaveLength(LFO_TABLE_SIZE + 1);
    expect([at(sineTable, 0), at(sineTable, 0.25), at(sineTable, 0.5)]).toEqual([0, Math.fround(0.5), 1]);
    const triangle = lfoTable('triangle');
    expect([at(triangle, 0), at(triangle, 0.25), at(triangle, 0.5), at(triangle, 0.75)]).toEqual([
      0, 0.5, 1, 0.5,
    ]);
    expect([at(lfoTable('saw-up'), 0), at(lfoTable('saw-up'), 0.5)]).toEqual([0, 0.5]);
    expect([at(lfoTable('saw-down'), 0), at(lfoTable('saw-down'), 0.5)]).toEqual([1, 0.5]);
    const square = lfoTable('square');
    expect([at(square, 0), at(square, 0.49), at(square, 0.5), at(square, 0.99)].map(Math.round)).toEqual([
      1, 1, 0, 0,
    ]);
    ['sine', 'triangle', 'saw-up', 'saw-down', 'square'].forEach((shape) => {
      const table = lfoTable(shape as 'sine');
      expect(table[LFO_TABLE_SIZE]).toBe(table[0]);
    });
  });

  it('draws points of its own: curved segments, a step at one x, the last one to the first over the end', () => {
    const table = lfoTable('sine', [
      [0, 0.2, 0],
      [0.25, 1, 3],
      [0.5, 0.2, 0],
      [0.5, 0, 0],
      [0.75, 0.5, 0],
    ]);
    const at = (x: number) => table[x * LFO_TABLE_SIZE];
    expect(at(0.125)).toBe(Math.fround(0.2 + 0.8 * 0.5));
    // the curve of the second segment
    expect(at(0.375)).toBe(Math.fround(1 + (0.2 - 1) * curveShape(3, 0.5)));
    // the step at 0.5, then up to 0.5 and back to the first level over the end of the cycle
    expect(at(0.5 - 1 / LFO_TABLE_SIZE)).toBeCloseTo(0.2, 2);
    expect(at(0.5)).toBe(0);
    expect(at(0.625)).toBe(0.25);
    expect(at(0.875)).toBe(Math.fround(0.5 + (0.2 - 0.5) * 0.5));
    expect(table[LFO_TABLE_SIZE]).toBe(table[0]);
  });

  it('takes a cycle of any length, linear around it, within 0..1', () => {
    const table = lfoTableFrom([0, 1, 2, NaN]);
    expect(table[0]).toBe(0);
    expect(table[256]).toBe(0.5);
    expect(table[512]).toBe(1);
    // 2 is 1, NaN is 0
    expect(table[1024]).toBe(1);
    expect(table[1536]).toBe(0);
    expect(table[LFO_TABLE_SIZE]).toBe(0);
    expect(lfoTableFrom([])).toEqual(new Float32Array(LFO_TABLE_SIZE + 1));
  });

  it('is read linearly between its levels', () => {
    const table = lfoTable('saw-up');
    expect(tableLevel(table, 0.3)).toBeCloseTo(0.3, 6);
    expect(tableLevel(table, 1 - 1e-17)).toBeCloseTo(0, 6);
  });
});

describe('the clock', () => {
  it('goes on from where it is at a new period: no step', () => {
    const anchors = [{ time: 0, phase: 0, period: 0.5 }];
    const anchor = nextAnchor(anchors, 1.3, 0.2);
    expect(anchor.phase).toBeCloseTo(0.6, 12);
    const both = [...anchors, anchor];
    expect(phaseAt(both, 1.3 - 1e-9)).toBeCloseTo(phaseAt(both, 1.3), 6);
    expect(phaseAt(both, 1.4)).toBeCloseTo(0.1, 12);
    // before the new anchor: the one before it
    expect(phaseAt(both, 1)).toBe(0);
  });

  it('takes the knobs of a state from its time on, the anchors kept (four)', () => {
    const lfo = lfoOf();
    lfo.set(1, wire({ delay: 0.5, anchor: { time: 1, phase: 0, period: 0.25 } }));
    expect(lfo.knobs(0.99).delay).toBe(0);
    expect(lfo.knobs(1).delay).toBe(0.5);
    expect(lfo.clock(0.99)).toBeCloseTo(0.98, 12);
    expect(lfo.clock(1.125)).toBeCloseTo(0.5, 12);
    // a later state: the one before is current from its time on
    lfo.set(2, wire({ delay: 0.75, anchor: { time: 1, phase: 0, period: 0.25 } }));
    expect(lfo.knobs(1.5).delay).toBe(0.5);
    expect(lfo.knobs(2).delay).toBe(0.75);
    for (let i = 3; i < 8; i++) lfo.set(i, wire({ anchor: { time: i, phase: 0, period: 0.5 } }));
    expect(lfo.anchors).toHaveLength(4);
  });

  it('glides a new Phase in 10 ms by the shortest arc', () => {
    const lfo = lfoOf({ phase: 0.9 });
    lfo.set(1, wire({ phase: 0.1 }));
    expect(lfo.phase(1)).toBe(0.9);
    // through 0, not 0.5
    const around = (phase: number) => Math.min(phase, 1 - phase);
    expect(around(lfo.phase(1 + LFO_GLIDE / 2))).toBeCloseTo(0, 12);
    expect(lfo.phase(1 + LFO_GLIDE / 4)).toBeCloseTo(0.95, 12);
    expect(lfo.phase(1 + LFO_GLIDE)).toBe(0.1);
  });

  it('crossfades a new shape in 10 ms from the one it plays then', () => {
    const lfo = lfoOf();
    lfo.set(1, { ...wire(), table: lfoTable('square') });
    expect(lfo.shape(0.25, 1)).toBeCloseTo(sine(0.25), 6);
    expect(lfo.shape(0.25, 1 + LFO_GLIDE / 2)).toBeCloseTo((sine(0.25) + 1) / 2, 6);
    expect(lfo.fading(1 + LFO_GLIDE / 2)).toBe(true);
    // a third shape halfway: from the halfway mix
    lfo.set(1 + LFO_GLIDE / 2, { ...wire(), table: lfoTable('saw-up') });
    expect(lfo.shape(0.25, 1 + LFO_GLIDE / 2)).toBeCloseTo((sine(0.25) + 1) / 2, 6);
    expect(lfo.shape(0.25, 1 + LFO_GLIDE * 1.5)).toBeCloseTo(0.25, 6);
    expect(lfo.fading(1 + LFO_GLIDE * 1.5)).toBe(false);
  });
});

describe('createLfoRunner', () => {
  it('retrig: a cycle from the start of the note', () => {
    const lfo = lfoOf({ anchor: { time: 0, phase: 0.3, period: 0.25 } });
    pointsOf(lfo, 1000, 1000, 1000 + 48000).forEach(([f, level]) =>
      expect(level).toBeCloseTo(sine(frac((f - 1000) / RATE / 0.25)), 5)
    );
  });

  it('free: on the clock, two notes in step', () => {
    const lfo = lfoOf({ mode: FREE, anchor: { time: 0, phase: 0.3, period: 0.25 } });
    const first = pointsOf(lfo, 0, 14400, 24000);
    const second = pointsOf(lfo, 14400, 14400, 24000);
    expect(second).toEqual(first);
    first.forEach(([f, level]) => expect(level).toBeCloseTo(sine(frac(0.3 + f / RATE / 0.25)), 5));
  });

  it('holds the left point during its Delay, then retrig starts its cycle there; Rise morphs into it linearly', () => {
    const lfo = lfoOf({ delay: 0.3, rise: 0.5, anchor: { time: 0, phase: 0, period: 0.25 } });
    pointsOf(lfo, 0, 0, 48000).forEach(([f, level]) => {
      const t = f / RATE;
      if (t < 0.3) expect(level).toBe(0);
      else expect(level).toBeCloseTo(sine(frac((t - 0.3) / 0.25)) * Math.min(1, (t - 0.3) / 0.5), 5);
    });
    // a saw down holds its left point, 1
    const saw = lfoOf({ delay: 0.1, anchor: { time: 0, phase: 0, period: 0.25 } });
    saw.set(0, { ...wire({ delay: 0.1 }), table: lfoTable('saw-down') }, true);
    expect(pointsOf(saw, 0, 0, 4800).every(([f, level]) => f >= 4800 || level === 1)).toBe(true);
  });

  it('free: its Delay and Rise from the note, on the clock', () => {
    const lfo = lfoOf({ mode: FREE, delay: 0.1, anchor: { time: 0, phase: 0, period: 0.25 } });
    pointsOf(lfo, 4800, 4800, 24000).forEach(([f, level]) => {
      const t = f / RATE;
      expect(level).toBeCloseTo(t < 0.2 ? 0 : sine(frac(t / 0.25)), 5);
    });
  });

  it('smooths a square by one pole of its time constant', () => {
    const lfo = lfoOf({ smooth: 0.025, anchor: { time: 0, phase: 0, period: 0.4 } });
    lfo.set(
      0,
      { ...wire({ smooth: 0.025, anchor: { time: 0, phase: 0, period: 0.4 } }), table: lfoTable('square') },
      true
    );
    const levels = pointsOf(lfo, 0, 0, 0.4 * RATE);
    // from the left point (1) at 1 for half a cycle (but for the last level of the table before the step), then
    // from 1 towards 0
    levels.forEach(([f, level]) => {
      const t = f / RATE;
      if (t < 0.199) expect(level).toBe(1);
      // the level of a point over the interval before it: the step falls from the point before it on (32 samples
      // at most)
      else if (t > 0.201 && t < 0.399) {
        expect(level).toBeLessThanOrEqual(Math.exp(-(t - 0.2) / 0.025) + 1e-6);
        expect(level).toBeGreaterThanOrEqual(Math.exp(-(t - 0.2 + LFO_SEGMENT / RATE) / 0.025) - 1e-6);
      }
    });
  });

  it('shifts the cycle by Phase, around it', () => {
    const lfo = lfoOf({ phase: 0.75, anchor: { time: 0, phase: 0, period: 0.25 } });
    const runner = createLfoRunner(RATE);
    runner.start(0);
    expect(runner.point(0, lfo)).toBeCloseTo(sine(0.75), 5);
    // a route moves it past the end of the cycle
    expect(runner.point(32, lfo, { phase: frac(0.75 + 0.5) })).toBeCloseTo(
      sine(frac(32 / RATE / 0.25 + 0.25)),
      5
    );
  });

  it('a route of Rate at twice the frequency runs its phase twice as fast', () => {
    const lfo = lfoOf({ anchor: { time: 0, phase: 0, period: 0.5 } });
    const runner = createLfoRunner(RATE);
    runner.start(0);
    let level = 0;
    for (let f = 0; f <= 4800; f += 32) level = runner.point(f, lfo, { rate: 4 });
    expect(level).toBeCloseTo(sine(frac((4800 / RATE) * 4)), 5);
  });

  it('switches the mode of a playing note at once: free on the clock, retrig as if from its Delay all along', () => {
    const lfo = lfoOf({ delay: 0.05, anchor: { time: 0, phase: 0, period: 0.25 } });
    const runner = createLfoRunner(RATE);
    runner.start(4800);
    for (let f = 4800; f < 9600; f += 32) runner.point(f, lfo);
    lfo.set(0.2, wire({ mode: FREE, delay: 0.05, anchor: { time: 0, phase: 0, period: 0.25 } }));
    expect(runner.point(9600, lfo)).toBeCloseTo(sine(frac(0.2 / 0.25)), 5);
    lfo.set(0.3, wire({ mode: RETRIG, delay: 0.05, anchor: { time: 0, phase: 0, period: 0.25 } }));
    expect(runner.point(14400, lfo)).toBeCloseTo(sine(frac((0.3 - 0.15) / 0.25)), 5);
  });

  it('starts again: retrig from 0 and its Delay again, the smoothing goes on', () => {
    const lfo = lfoOf({ delay: 0.01, anchor: { time: 0, phase: 0, period: 0.25 } });
    const runner = createLfoRunner(RATE);
    runner.start(0);
    for (let f = 0; f < 6000; f += 32) runner.point(f, lfo);
    runner.retrigger(6000);
    expect(runner.point(5999, lfo)).not.toBe(0);
    expect(runner.point(6000, lfo)).toBe(0);
    expect(runner.point(6000 + 480, lfo)).toBe(0);
    expect(runner.point(6000 + 480 + 1200, lfo)).toBeCloseTo(sine(1200 / RATE / 0.25), 5);
  });

  it('without a note runs on the clock, its Delay and Rise passed', () => {
    const lfo = lfoOf({ delay: 1, rise: 1, anchor: { time: 0, phase: 0.1, period: 0.25 } });
    const runner = createLfoRunner(RATE);
    runner.free();
    expect(runner.at(4800, lfo)).toBeCloseTo(sine(frac(0.1 + 0.1 / 0.25)), 5);
  });

  it('steps to a later frame in points of 32 samples at most, a frame before the last one gives its level', () => {
    const lfo = lfoOf({ smooth: 0.01 });
    const stepped = createLfoRunner(RATE);
    stepped.start(0);
    stepped.at(0, lfo);
    const pointed = createLfoRunner(RATE);
    pointed.start(0);
    let level = 0;
    for (let f = 0; f < 1000; f += 32) level = pointed.point(f, lfo);
    level = pointed.point(1000, lfo);
    expect(stepped.at(1000, lfo)).toBe(level);
    expect(stepped.at(900, lfo)).toBe(level);
  });
});
