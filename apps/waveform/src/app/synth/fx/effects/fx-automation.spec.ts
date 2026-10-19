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
    expect(calls('cancelAndHoldAtTime')).toEqual([[0.5]]);
    // until the start of the note it stays
    expect(calls('setValueAtTime')).toEqual([[0.2, 1]]);
    expect(calls('linearRampToValueAtTime')).toEqual([
      [0.2, 0.51],
      [expect.closeTo(0.6, 9), expect.closeTo(1.1, 9)],
      [expect.closeTo(0.4, 9), expect.closeTo(1.2, 9)],
    ]);
  });

  it('from where the param is to the knob in 10 ms, through the release', () => {
    const { param, calls } = setup();
    scheduleRouted(param, 1.05, note(2), [time], 0.2, 'linear');
    expect(calls('setValueAtTime')).toEqual([]);
    expect(calls('linearRampToValueAtTime')).toEqual([
      [expect.closeTo(0.44, 9), expect.closeTo(1.06, 9)],
      [expect.closeTo(0.6, 9), expect.closeTo(1.1, 9)],
      [expect.closeTo(0.4, 9), expect.closeTo(1.2, 9)],
      [expect.closeTo(0.4, 9), 2],
      [expect.closeTo(0.2, 9), 2.2],
    ]);
  });

  it('a new note does not step: the param glides from where it is into its attack', () => {
    const { param, calls } = setup();
    // the knob was moved up by the last note: it is held there, not set at the base the new attack starts at
    scheduleRouted(param, 1, note(), [time], 0.2, 'linear');
    expect(calls('cancelAndHoldAtTime')).toEqual([[1]]);
    expect(calls('cancelScheduledValues')).toEqual([]);
    expect(calls('setValueAtTime')).toEqual([]);
    expect(calls('linearRampToValueAtTime')[0]).toEqual([expect.closeTo(0.24, 9), expect.closeTo(1.01, 9)]);
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
    // the glide, then the 15 segments of the attack
    expect(segments).toHaveLength(16);
    expect(segments[1]).toEqual([expect.closeTo(0.5 + 1 / 15, 6), expect.closeTo(1 + 0.1 / 15, 9)]);
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
    expect(segments).toHaveLength(31);
    expect(segments[0]).toEqual([0.4, 0.01]);
    expect(segments[15]).toEqual([expect.closeTo(1.2, 6), expect.closeTo(1.1, 9)]);
    expect(segments[30]).toEqual([expect.closeTo(0.8, 6), expect.closeTo(1.2, 9)]);
    expect(calls('setValueAtTime')).toEqual([[0.4, 1]]);
    expect(calls('setValueCurveAtTime')).toEqual([]);
  });
});

describe('holdParam', () => {
  it('cancels what is scheduled and stays where its automation is', () => {
    const { param, calls } = setup();
    holdParam(param, 2);
    expect(calls('cancelAndHoldAtTime')).toEqual([[2]]);
    expect(calls('cancelScheduledValues')).toEqual([]);
  });

  it('without cancelAndHoldAtTime (Firefox) stays at the value read before the automation is cancelled', () => {
    // after the cancel the value is that of the event before the ramp that was running
    let value = 0.3;
    const param = {
      get value() {
        return value;
      },
      cancelScheduledValues: jest.fn(() => (value = 0.1)),
      setValueAtTime: jest.fn(),
    } as unknown as AudioParam;
    holdParam(param, 2);
    expect(param.cancelScheduledValues).toHaveBeenCalledWith(2);
    expect(param.setValueAtTime).toHaveBeenCalledWith(0.3, 2);
  });
});
