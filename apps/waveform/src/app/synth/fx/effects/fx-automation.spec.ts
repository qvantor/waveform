import { EnvelopeParams, envelopeValue } from '../../common/envelope/envelope-curve';
import { withCurves } from '../../../../test-utils/envelopes';
import { FxNote, FxRoute } from './fx-modulation';
import { glideParam, holdParam, scheduleRouted, setParam } from './fx-automation';

const FLAT: EnvelopeParams = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
const ENV: EnvelopeParams = { attack: 0.1, hold: 0, decay: 0.1, sustain: 0.5, release: 0.2 };
const note = (release: number | null = null): FxNote => ({ envelopes: [FLAT, ENV, FLAT], start: 1, release });
const time: FxRoute = { param: 'time', env: 1, amount: 0.4, min: 0.01, max: 1 };

const METHODS = [
  'setValueAtTime',
  'linearRampToValueAtTime',
  'exponentialRampToValueAtTime',
  'setTargetAtTime',
  'cancelScheduledValues',
  'cancelAndHoldAtTime',
] as const;

// a param at rest at `value` (set here), its calls from then on
const setup = (value = 0.2) => {
  const param = new AudioContext().createGain().gain;
  setParam(param, value, 0);
  METHODS.forEach((method) => (param[method] as jest.Mock).mockClear());
  const calls = (method: keyof AudioParam) => (param[method] as jest.Mock).mock.calls;
  return { param, calls };
};

// the order of a call of a method of a mock
const order = (param: AudioParam, method: keyof AudioParam, index = 0) =>
  (param[method] as jest.Mock).mock.invocationCallOrder[index];

describe('scheduleRouted', () => {
  it('ramps a linear knob from 10 ms after now through the corners of the envelope, from where it is then', () => {
    const { param, calls } = setup();
    scheduleRouted(param, 0.5, note(), [time], 0.2, 'linear');
    // held 10 ms after now (the events reach the audio thread before it gets there), what follows cancelled;
    // not by cancelAndHoldAtTime
    expect(calls('cancelAndHoldAtTime')).toEqual([]);
    expect(calls('cancelScheduledValues')).toEqual([[expect.closeTo(0.5101, 9)]]);
    // until the start of the note it stays
    expect(calls('setValueAtTime')).toEqual([
      [0.2, 0.51],
      [0.2, 1],
    ]);
    expect(calls('linearRampToValueAtTime')).toEqual([
      [0.2, 0.52],
      [expect.closeTo(0.6, 9), expect.closeTo(1.1, 9)],
      [expect.closeTo(0.4, 9), expect.closeTo(1.2, 9)],
    ]);
  });

  it('from where the param is to the knob in 10 ms, through the release', () => {
    const { param, calls } = setup();
    scheduleRouted(param, 1.05, note(2), [time], 0.2, 'linear');
    // the sustain stays (exactly: the corners are the sums of its stages)
    expect(calls('setValueAtTime')).toEqual([
      [0.2, 1.06],
      [0.4, 2],
    ]);
    expect(calls('linearRampToValueAtTime')).toEqual([
      [expect.closeTo(0.48, 9), expect.closeTo(1.07, 9)],
      [expect.closeTo(0.6, 9), expect.closeTo(1.1, 9)],
      [expect.closeTo(0.4, 9), expect.closeTo(1.2, 9)],
      [expect.closeTo(0.2, 9), 2.2],
    ]);
  });

  it('holds a stage that ends in a step and steps at its corner', () => {
    const { param, calls } = setup();
    // a decay of 0 to a sustain of 0: the hold stays at the top until 0.6 after the start, then the knob drops
    const pluck: EnvelopeParams = { attack: 0.1, hold: 0.5, decay: 0, sustain: 0, release: 0.2 };
    scheduleRouted(param, 0.5, { ...note(), envelopes: [FLAT, pluck, FLAT] }, [time], 0.2, 'linear');
    expect(calls('linearRampToValueAtTime')).toEqual([
      [0.2, 0.52],
      [expect.closeTo(0.6, 9), expect.closeTo(1.1, 9)],
    ]);
    expect(calls('setValueAtTime')).toEqual([
      [0.2, 0.51],
      [0.2, 1],
      [expect.closeTo(0.6, 9), expect.closeTo(1.6, 9)],
      [expect.closeTo(0.2, 9), expect.closeTo(1.6, 9)],
    ]);
  });

  it('reaches the top of an attack followed by a step to the sustain, holds the sustain to a release of 0', () => {
    const { param, calls } = setup();
    const step: EnvelopeParams = { attack: 0.1, hold: 0, decay: 0, sustain: 0.5, release: 0 };
    scheduleRouted(
      param,
      0.5,
      { envelopes: [FLAT, step, FLAT], start: 1, release: 2 },
      [time],
      0.2,
      'linear'
    );
    expect(calls('linearRampToValueAtTime')).toEqual([
      [0.2, 0.52],
      [expect.closeTo(0.6, 9), expect.closeTo(1.1, 9)],
    ]);
    expect(calls('setValueAtTime')).toEqual([
      [0.2, 0.51],
      [0.2, 1],
      [expect.closeTo(0.4, 9), expect.closeTo(1.1, 9)],
      [expect.closeTo(0.4, 9), 2],
      [expect.closeTo(0.2, 9), 2],
    ]);
  });

  it('holds the base until a start in the future with an attack of 0, then steps', () => {
    const { param, calls } = setup();
    scheduleRouted(param, 0.5, { ...note(), envelopes: [FLAT, FLAT, FLAT] }, [time], 0.2, 'linear');
    expect(calls('linearRampToValueAtTime')).toEqual([[0.2, 0.52]]);
    expect(calls('setValueAtTime')).toEqual([
      [0.2, 0.51],
      [0.2, 1],
      [expect.closeTo(0.6, 9), 1],
    ]);
  });

  it('a new note does not step: the param is held on the line of the last one and glides into its attack', () => {
    const { param, calls } = setup();
    scheduleRouted(param, 0.5, note(), [time], 0.2, 'linear');
    // the next note in the middle of the attack of the last one (0.2 at 1 to 0.6 at 1.1): at 1.05, 0.4, not
    // set at the base the new attack starts at
    scheduleRouted(param, 1.04, { ...note(), start: 1.04 }, [time], 0.2, 'linear');
    const ramps = calls('linearRampToValueAtTime').slice(3);
    expect(ramps[0]).toEqual([expect.closeTo(0.4, 9), 1.05]);
    expect(calls('cancelScheduledValues').at(-1)).toEqual([expect.closeTo(1.0501, 9)]);
    // the point, the cancel after it, then the glide from it
    expect(order(param, 'linearRampToValueAtTime', 3)).toBeLessThan(order(param, 'cancelScheduledValues', 1));
    expect(order(param, 'cancelScheduledValues', 1)).toBeLessThan(order(param, 'linearRampToValueAtTime', 4));
    expect(ramps[1]).toEqual([expect.closeTo(0.28, 9), expect.closeTo(1.06, 9)]);
    expect(calls('setValueAtTime')).toHaveLength(2);
    expect(calls('cancelAndHoldAtTime')).toEqual([]);
  });

  it('a note that started the envelopes again from their levels (mono) glides on from there, no dip', () => {
    const { param, calls } = setup();
    scheduleRouted(param, 0.5, note(), [time], 0.2, 'linear');
    // on the sustain (0.4), ENV 2 started again at 3 from 0.5: at 3.02 it is at 0.6 (from 0 it would be 0.2)
    scheduleRouted(param, 3, { ...note(), start: 3, from: [1, 0.5, 1] }, [time], 0.2, 'linear');
    expect(calls('setValueAtTime').at(-1)).toEqual([expect.closeTo(0.4, 9), 3.01]);
    const ramps = calls('linearRampToValueAtTime').slice(3);
    expect(ramps[0]).toEqual([expect.closeTo(0.44, 9), expect.closeTo(3.02, 9)]);
    expect(ramps[1]).toEqual([expect.closeTo(0.6, 9), expect.closeTo(3.1, 9)]);
  });

  it('a corner sooner than the glide ends it: a short attack and decay are not skipped', () => {
    const { param, calls } = setup();
    const short: EnvelopeParams = { attack: 0.002, hold: 0, decay: 0.008, sustain: 0, release: 0 };
    // from 10 ms after now: the start of the note
    scheduleRouted(param, 0.99, { ...note(), envelopes: [FLAT, short, FLAT] }, [time], 0.2, 'linear');
    expect(calls('linearRampToValueAtTime')).toEqual([
      [expect.closeTo(0.6, 9), expect.closeTo(1.002, 9)],
      [expect.closeTo(0.2, 9), expect.closeTo(1.01, 9)],
    ]);
    expect(calls('setValueAtTime')).toEqual([[0.2, 1]]);
  });

  it('steps at a corner the glide ends at where the envelope steps', () => {
    const { param, calls } = setup();
    const held: EnvelopeParams = { attack: 0, hold: 0.005, decay: 0, sustain: 0.5, release: 0 };
    scheduleRouted(param, 0.99, { ...note(), envelopes: [FLAT, held, FLAT] }, [time], 0.2, 'linear');
    expect(calls('linearRampToValueAtTime')).toEqual([[expect.closeTo(0.6, 9), expect.closeTo(1.005, 9)]]);
    expect(calls('setValueAtTime')).toEqual([
      [0.2, 1],
      [expect.closeTo(0.4, 9), expect.closeTo(1.005, 9)],
    ]);
  });

  it('ramps a log knob exponentially', () => {
    const { param, calls } = setup(1000);
    const freq: FxRoute = { param: 'freq', env: 1, amount: 2, min: 50, max: 17000, log: true };
    scheduleRouted(param, 0, note(), [freq], 1000, 'exponential');
    expect(calls('exponentialRampToValueAtTime')).toEqual([
      [expect.closeTo(4000, 6), expect.closeTo(1.1, 9)],
      [expect.closeTo(2000, 6), expect.closeTo(1.2, 9)],
    ]);
  });

  it('a stage that reaches the end of the range is a curve in linear segments, clamped there', () => {
    const { param, calls } = setup(0.5);
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

  it('cuts a curved decay and release into linear segments on their curve, a linear attack one ramp', () => {
    const { param, calls } = setup();
    const curved = withCurves(ENV);
    const fxNote: FxNote = { envelopes: [FLAT, curved, FLAT], start: 1, release: 1.3 };
    scheduleRouted(param, 0.5, fxNote, [time], 0.2, 'linear');
    const ramps = calls('linearRampToValueAtTime');
    // the glide, the attack in one ramp (linear), the decay and the release in 15 segments each
    expect(ramps).toHaveLength(1 + 1 + 15 + 15);
    expect(ramps[1]).toEqual([expect.closeTo(0.6, 9), expect.closeTo(1.1, 9)]);
    // every end of a segment on the curve of the envelope: base + amount × its level
    ramps.slice(2).forEach(([value, at]) => {
      const t = at - fxNote.start;
      expect(value).toBeCloseTo(0.2 + 0.4 * envelopeValue(curved, t, 0.3), 9);
    });
    // the decay falls fast at first: its first segment does more than a 15th of it
    const [[first]] = ramps.slice(2);
    expect(0.6 - first).toBeGreaterThan(0.2 / 15);
  });

  it('maps the knob to its param: linear segments for a map that is not a ramp', () => {
    const { param, calls } = setup(0.4);
    scheduleRouted(param, 0, note(), [time], 0.2, 'curve', (value) => value * 2);
    const segments = calls('linearRampToValueAtTime');
    expect(segments).toHaveLength(31);
    expect(segments[0]).toEqual([0.4, 0.02]);
    expect(segments[15]).toEqual([expect.closeTo(1.2, 6), expect.closeTo(1.1, 9)]);
    expect(segments[30]).toEqual([expect.closeTo(0.8, 6), expect.closeTo(1.2, 9)]);
    expect(calls('setValueAtTime')).toEqual([
      [0.4, 0.01],
      [0.4, 1],
    ]);
    expect(calls('setValueCurveAtTime')).toEqual([]);
  });

  it('holds an exponential stage on its curve, a flat one or the end with a step to where it is', () => {
    const exponential = setup(1000);
    const freq: FxRoute = { param: 'freq', env: 1, amount: 2, min: 50, max: 17000, log: true };
    scheduleRouted(exponential.param, 0, note(), [freq], 1000, 'exponential');
    // 1000 at 1 to 4000 at 1.1: 2000 halfway
    scheduleRouted(exponential.param, 1.04, note(), [freq], 1000, 'exponential');
    expect(exponential.calls('exponentialRampToValueAtTime')[2]).toEqual([expect.closeTo(2000, 6), 1.05]);

    const flat = setup();
    scheduleRouted(flat.param, 0.5, note(), [time], 0.2, 'linear');
    // the base until the start of the note
    scheduleRouted(flat.param, 0.8, note(), [time], 0.2, 'linear');
    expect(flat.calls('setValueAtTime')[2]).toEqual([0.2, 0.81]);
    // the sustain after the decay (the glide then stays there: no corner after it)
    scheduleRouted(flat.param, 3, note(), [time], 0.2, 'linear');
    expect(flat.calls('setValueAtTime').at(-1)).toEqual([expect.closeTo(0.4, 9), 3.01]);
    expect(flat.calls('linearRampToValueAtTime').at(-1)).toEqual([
      expect.closeTo(0.4, 9),
      expect.closeTo(3.02, 9),
    ]);
  });

  it('held again before it took over (within 10 ms) at the point it starts at', () => {
    const { param, calls } = setup();
    scheduleRouted(param, 1.04, note(), [time], 0.2, 'linear');
    holdParam(param, 1.045);
    // the point at 1.05 is a step to where the param was: the same, sooner
    expect(calls('setValueAtTime').at(-1)).toEqual([0.2, 1.045]);
    expect(calls('cancelScheduledValues').at(-1)).toEqual([expect.closeTo(1.0451, 9)]);
  });
});

describe('holdParam', () => {
  it('holds an automation of scheduleRouted at a point of its line, a glide after it on its curve', () => {
    const { param, calls } = setup();
    scheduleRouted(param, 0.5, note(), [time], 0.2, 'linear');
    // in the decay: 0.6 at 1.1 to 0.4 at 1.2
    holdParam(param, 1.15);
    expect(calls('linearRampToValueAtTime').at(-1)).toEqual([expect.closeTo(0.5, 9), 1.15]);
    expect(calls('cancelScheduledValues').at(-1)).toEqual([expect.closeTo(1.1501, 9)]);
    // a knob glides from there (setTargetAtTime): one time constant later 1 - 1/e of the way
    glideParam(param, 0.9, 1.2, 0.1);
    holdParam(param, 1.3);
    expect(calls('setValueAtTime').at(-1)).toEqual([expect.closeTo(0.9 - 0.4 / Math.E, 9), 1.3]);
    expect(calls('cancelAndHoldAtTime')).toEqual([]);
  });

  it('a glide over a glide starts where the first one is', () => {
    const { param, calls } = setup(0);
    glideParam(param, 1, 1, 0.1);
    glideParam(param, 0, 1.1, 0.1);
    holdParam(param, 1.2);
    // from 1 - 1/e at 1.1 back towards 0 for a time constant
    expect(calls('setValueAtTime').at(-1)).toEqual([expect.closeTo((1 - 1 / Math.E) / Math.E, 9), 1.2]);
  });

  it('a param nothing was scheduled on here stays at its value read before the cancel', () => {
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
    expect(param.setValueAtTime).toHaveBeenCalledWith(0.3, 2);
    expect(param.cancelScheduledValues).toHaveBeenCalledWith(expect.closeTo(2.0001, 9));
  });
});
