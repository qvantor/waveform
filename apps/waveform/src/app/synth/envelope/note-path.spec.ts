import { noteCorners, outputTime } from './note-path';

const env = { attack: 0.25, hold: 0.25, decay: 0.5, sustain: 0.5, release: 1 };

describe('noteCorners', () => {
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
