import { EnvelopeParams } from '../../common/envelope/envelope-curve';
import { FxNote, FxRoute } from './fx-modulation';
import { holdParam, scheduleRouted } from './fx-automation';

const FLAT: EnvelopeParams = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
const ENV: EnvelopeParams = { attack: 0.1, hold: 0, decay: 0.1, sustain: 0.5, release: 0.2 };
const note = (release: number | null = null): FxNote => ({ envelopes: [FLAT, ENV, FLAT], start: 1, release });
const time: FxRoute = { param: 'time', env: 1, amount: 0.4, min: 0.01, max: 1 };

const setup = () => {
  const param = new AudioContext().createGain().gain;
  const calls = (method: keyof AudioParam) => (param[method] as jest.Mock).mock.calls;
  return { param, calls };
};

describe('scheduleRouted', () => {
  it('ramps a linear knob from now through the corners of the envelope', () => {
    const { param, calls } = setup();
    scheduleRouted(param, 0.5, note(), [time], 0.2, 'linear');
    expect(calls('cancelScheduledValues')).toEqual([[0.5]]);
    // until the start of the note it stays
    expect(calls('setValueAtTime')).toEqual([
      [0.2, 0.5],
      [0.2, 1],
    ]);
    expect(calls('linearRampToValueAtTime')).toEqual([
      [expect.closeTo(0.6, 9), expect.closeTo(1.1, 9)],
      [expect.closeTo(0.4, 9), expect.closeTo(1.2, 9)],
    ]);
  });

  it('from the value of the knob now, through the release', () => {
    const { param, calls } = setup();
    scheduleRouted(param, 1.05, note(2), [time], 0.2, 'linear');
    expect(calls('setValueAtTime')).toEqual([[expect.closeTo(0.4, 9), 1.05]]);
    expect(calls('linearRampToValueAtTime')).toEqual([
      [expect.closeTo(0.6, 9), expect.closeTo(1.1, 9)],
      [expect.closeTo(0.4, 9), expect.closeTo(1.2, 9)],
      [expect.closeTo(0.4, 9), 2],
      [expect.closeTo(0.2, 9), 2.2],
    ]);
  });

  it('ramps a log knob exponentially', () => {
    const { param, calls } = setup();
    const freq: FxRoute = { param: 'freq', env: 1, amount: 2, min: 50, max: 17000, log: true };
    scheduleRouted(param, 0, note(), [freq], 1000, 'exponential');
    expect(calls('exponentialRampToValueAtTime')).toEqual([
      [expect.closeTo(4000, 6), expect.closeTo(1.1, 9)],
      [expect.closeTo(2000, 6), expect.closeTo(1.2, 9)],
    ]);
  });

  it('a stage that reaches the end of the range is a curve in linear segments, clamped there', () => {
    const { param, calls } = setup();
    scheduleRouted(param, 0, note(), [{ ...time, amount: 1 }], 0.5, 'linear');
    // the attack: up to 1.5, clamped at 1 from its middle on; the decay stays there
    const segments = calls('linearRampToValueAtTime');
    expect(segments).toHaveLength(15);
    expect(segments[0]).toEqual([expect.closeTo(0.5 + 1 / 15, 6), expect.closeTo(1 + 0.1 / 15, 9)]);
    expect(segments.at(-1)).toEqual([1, expect.closeTo(1.1, 9)]);
    expect(Math.max(...segments.map(([value]) => value))).toBe(1);
    expect(calls('setValueAtTime').at(-1)).toEqual([1, expect.closeTo(1.2, 9)]);
    // a curve still running would throw at the next event scheduled inside it
    expect(calls('setValueCurveAtTime')).toEqual([]);
  });

  it('maps the knob to its param: linear segments for a map that is not a ramp', () => {
    const { param, calls } = setup();
    scheduleRouted(param, 0, note(), [time], 0.2, 'curve', (value) => value * 2);
    const segments = calls('linearRampToValueAtTime');
    expect(segments).toHaveLength(30);
    expect(segments[14]).toEqual([expect.closeTo(1.2, 6), expect.closeTo(1.1, 9)]);
    expect(segments[29]).toEqual([expect.closeTo(0.8, 6), expect.closeTo(1.2, 9)]);
    expect(calls('setValueAtTime')).toEqual([
      [0.4, 0],
      [0.4, 1],
    ]);
    expect(calls('setValueCurveAtTime')).toEqual([]);
  });
});

describe('holdParam', () => {
  it('cancels what is scheduled and stays where it is', () => {
    const { param, calls } = setup();
    param.value = 0.3;
    holdParam(param, 2);
    expect(calls('cancelScheduledValues')).toEqual([[2]]);
    expect(calls('setValueAtTime')).toEqual([[0.3, 2]]);
  });
});
