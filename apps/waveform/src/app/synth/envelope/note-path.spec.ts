import { curveShape, envelopeLevel, envelopeValue } from '../common/envelope/envelope-curve';
import { withCurves } from '../../../test-utils/envelopes';
import { noteCorners, outputTime } from './note-path';

const env = { attack: 0.25, hold: 0.25, decay: 0.5, sustain: 0.5, release: 1 };

describe('noteCorners', () => {
  describe('curved stages (the default shape: the decay and the release)', () => {
    const curved = withCurves(env);
    // a point of the path is on the curve of the chart: its level at its x on the chart
    const onDecay = ([, x, level]: number[]) => expect(level).toBeCloseTo(envelopeLevel(curved, x), 9);

    it('held: points along the curved decay, at its level at their time', () => {
      const corners = noteCorners(curved, null);
      // the attack and the hold have their corners alone, the decay 15 points between its corners
      expect(corners).toHaveLength(4 + 15);
      expect(corners.slice(0, 3)).toEqual([
        [0, 0, 0],
        [0.25, 0.25, 1],
        [0.5, 0.5, 1],
      ]);
      expect(corners.at(-1)).toEqual([1, 1, 0.5]);
      corners.slice(3, -1).forEach((point) => {
        expect(point[0]).toBe(point[1]);
        onDecay(point);
      });
    });

    it('released: from the sustain corner along the curved release of the chart to 0', () => {
      const corners = noteCorners(curved, 2);
      // after the sustain corner the release starts from (the last point at the time of the release)
      const start = corners.map(([time]) => time).lastIndexOf(2);
      const release = corners.slice(start + 1);
      expect(release).toHaveLength(15 + 1);
      expect(release.at(-1)).toEqual([3, 2, 0]);
      release.slice(0, -1).forEach(([time, x, level]) => {
        expect(x - 1).toBeCloseTo(time - 2, 12);
        // the chart's release: from the sustain at its curve
        expect(level).toBeCloseTo(envelopeValue(curved, x, 1), 9);
        expect(level).toBeCloseTo(0.5 * (1 - curveShape(3.49, x - 1)), 9);
      });
    });

    it('released in the decay: the points of the decay up to then, the level reached there', () => {
      const corners = noteCorners(curved, 0.75);
      const at = corners.findIndex(([time]) => time === 0.75);
      corners.slice(3, at).forEach((point) => {
        expect(point[0]).toBeLessThan(0.75);
        onDecay(point);
      });
      expect(corners[at]).toEqual([0.75, 0.75, envelopeLevel(curved, 0.75)]);
    });
  });

  it('held: the attack, the hold and the decay to the sustain corner', () => {
    expect(noteCorners(env, null)).toEqual([
      [0, 0, 0],
      [0.25, 0.25, 1],
      [0.5, 0.5, 1],
      [1, 1, 0.5],
    ]);
  });

  it('released on the sustain: from the sustain corner along the release to 0', () => {
    expect(noteCorners(env, 2)).toEqual([
      [0, 0, 0],
      [0.25, 0.25, 1],
      [0.5, 0.5, 1],
      [1, 1, 0.5],
      [2, 1, 0.5],
      [2, 1, 0.5],
      [3, 2, 0],
    ]);
  });

  it('released in the decay: a step to the sustain corner, then along the release line of the chart', () => {
    expect(noteCorners(env, 0.75)).toEqual([
      [0, 0, 0],
      [0.25, 0.25, 1],
      [0.5, 0.5, 1],
      [0.75, 0.75, 0.75],
      [0.75, 1, 0.5],
      [1.75, 2, 0],
    ]);
  });

  it('started again from a level: from its point on the attack line to the top in the time of the attack', () => {
    expect(noteCorners(env, null, 0.6)).toEqual([
      [0, 0.15, 0.6],
      [0.25, 0.25, 1],
      [0.5, 0.5, 1],
      [1, 1, 0.5],
    ]);
    // released in the attack at 0.8: on the line there
    expect(noteCorners(env, 0.125, 0.6)).toEqual([
      [0, 0.15, 0.6],
      [0.125, expect.closeTo(0.2, 9), expect.closeTo(0.8, 9)],
      [0.125, 1, 0.5],
      [1.125, 2, 0],
    ]);
  });

  it('released in the attack', () => {
    expect(noteCorners(env, 0.125)).toEqual([
      [0, 0, 0],
      [0.125, 0.125, 0.5],
      [0.125, 1, 0.5],
      [1.125, 2, 0],
    ]);
    expect(noteCorners({ ...env, sustain: 0.25 }, 0.125).slice(-2)).toEqual([
      [0.125, 1, 0.25],
      [1.125, 2, 0],
    ]);
  });

  it('stages of 0 are steps', () => {
    const steps = { attack: 0, hold: 0, decay: 0, sustain: 0.5, release: 0 };
    expect(noteCorners(steps, null)).toEqual([
      [0, 0, 0],
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 0.5],
    ]);
    expect(noteCorners(steps, 1).slice(-3)).toEqual([
      [1, 0, 0.5],
      [1, 0, 0.5],
      [1, 0, 0],
    ]);
  });
});

describe('outputTime', () => {
  beforeEach(() => jest.spyOn(performance, 'now').mockReturnValue(2000));
  afterEach(() => jest.restoreAllMocks());

  const context = (output?: AudioTimestamp) =>
    ({
      currentTime: 1,
      baseLatency: 0.01,
      outputLatency: 0.02,
      getOutputTimestamp: output && (() => output),
    } as unknown as AudioContext);

  it('the time the output plays a time of the context at, from getOutputTimestamp', () => {
    expect(outputTime(context({ contextTime: 0.99, performanceTime: 1010 }), 1.5)).toBeCloseTo(1520);
  });

  it('without one (or zero before the context runs): the time rendered now plus the latencies', () => {
    expect(outputTime(context(), 1.5)).toBeCloseTo(2530);
    expect(outputTime(context({ contextTime: 0, performanceTime: 0 }), 1.5)).toBeCloseTo(2530);
  });
});
