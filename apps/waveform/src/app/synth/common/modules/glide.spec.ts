import { GLIDE_SEGMENTS, glideFrom, glideValue, scheduleGlide, steady } from './glide';

const ramps = (glide: Parameters<typeof scheduleGlide>[1]) => {
  const param = { exponentialRampToValueAtTime: jest.fn() } as unknown as AudioParam;
  scheduleGlide(param, glide);
  return (param.exponentialRampToValueAtTime as jest.Mock).mock.calls as [number, number][];
};
const cents = (from: number, to: number) => 1200 * Math.log2(to / from);

describe('glide', () => {
  const up = { from: 110, to: 440, start: 1, seconds: 0.2 };

  it('reaches the target exactly at its end, in 8 exponential ramps', () => {
    const points = ramps(up);
    expect(points).toHaveLength(GLIDE_SEGMENTS);
    expect(points.at(-1)).toEqual([440, 1.2]);
    points.forEach(([, time], i) => expect(time).toBeCloseTo(1 + (0.2 * (i + 1)) / GLIDE_SEGMENTS, 12));
  });

  it('goes one way, up or down', () => {
    [up, { ...up, from: 440, to: 110 }].forEach((glide) => {
      const values = [glide.from, ...ramps(glide).map(([value]) => value)];
      const steps = values.slice(1).map((value, i) => value - values[i]);
      expect(steps.every((step) => Math.sign(step) === Math.sign(glide.to - glide.from))).toBe(true);
    });
  });

  it('is convex in pitch: more than half of the interval in the first half of the time', () => {
    const [, , , [half]] = ramps(up);
    expect(cents(110, half)).toBeCloseTo(0.75 * 2400, 6);
    expect(cents(110, glideValue(up, 1.1))).toBeGreaterThan(1200);
  });

  it('gives the value of the ramps at any time: from where an interrupted glide goes on', () => {
    const points = ramps(up);
    expect(glideValue(up, 0.5)).toBe(110);
    expect(glideValue(up, 2)).toBe(440);
    // on a point, and exponential between two
    expect(glideValue(up, points[2][1])).toBeCloseTo(points[2][0], 9);
    const middle = (points[2][1] + points[3][1]) / 2;
    expect(glideValue(up, middle)).toBeCloseTo(Math.sqrt(points[2][0] * points[3][0]), 9);
    expect(glideValue({ ...up, seconds: 0 }, 1)).toBe(440);
  });

  it('goes on from where the glide it is on has the param: held there, the rest cancelled, then the ramps', () => {
    const param = {
      setValueAtTime: jest.fn(),
      cancelScheduledValues: jest.fn(),
      exponentialRampToValueAtTime: jest.fn(),
    };
    const next = glideFrom(param as unknown as AudioParam, up, 220, 1.1, 0.1);
    const held = glideValue(up, 1.1);
    expect(next).toEqual({ from: held, to: 220, start: 1.1, seconds: 0.1 });
    expect(param.setValueAtTime.mock.calls).toEqual([[held, 1.1]]);
    expect(param.cancelScheduledValues.mock.calls).toEqual([[expect.closeTo(1.1, 3)]]);
    expect(param.cancelScheduledValues.mock.calls[0][0]).toBeGreaterThan(1.1);
    expect(param.exponentialRampToValueAtTime.mock.calls.at(-1)).toEqual([220, expect.closeTo(1.2, 12)]);
    expect(param.setValueAtTime.mock.invocationCallOrder[0]).toBeLessThan(
      param.cancelScheduledValues.mock.invocationCallOrder[0]
    );

    // 0 seconds: a step, no ramps
    param.exponentialRampToValueAtTime.mockClear();
    expect(glideFrom(param as unknown as AudioParam, next, 330, 1.15, 0)).toEqual(steady(330, 1.15));
    expect(param.setValueAtTime.mock.calls.at(-1)).toEqual([330, 1.15]);
    expect(param.exponentialRampToValueAtTime).not.toHaveBeenCalled();
  });
});
