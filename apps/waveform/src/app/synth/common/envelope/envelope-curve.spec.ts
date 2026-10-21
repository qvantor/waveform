import { readFileSync } from 'fs';
import { join } from 'path';
import {
  curvedAt,
  curveShape,
  EnvelopeParams,
  envelopeLevel,
  envelopeStage,
  envelopeValue,
  envelopeValueBefore,
} from './envelope-curve';

const env: EnvelopeParams = { attack: 0.1, hold: 0.2, decay: 0.4, sustain: 0.5, release: 1 };

const stage = (params: EnvelopeParams, t: number, releasedAt = Infinity, from = 0) =>
  Array.from(envelopeStage(params, t, releasedAt, new Float64Array(3), from));

describe('envelope curve', () => {
  it('goes through attack, hold, decay and sustain linearly', () => {
    expect(envelopeLevel(env, -0.1)).toBe(0);
    expect(envelopeLevel(env, 0)).toBe(0);
    expect(envelopeLevel(env, 0.05)).toBeCloseTo(0.5);
    expect(envelopeLevel(env, 0.1)).toBe(1);
    expect(envelopeLevel(env, 0.25)).toBe(1);
    expect(envelopeLevel(env, 0.5)).toBeCloseTo(0.75);
    expect(envelopeLevel(env, 0.7)).toBe(0.5);
    expect(envelopeLevel(env, 100)).toBe(0.5);
  });

  it('starts at full level without an attack, skips stages of 0 seconds', () => {
    const instant = { attack: 0, hold: 0, decay: 0, sustain: 0.3, release: 0 };
    expect(envelopeLevel(instant, 0)).toBe(0.3);
    expect(envelopeLevel({ ...instant, decay: 1 }, 0)).toBe(1);
    expect(envelopeLevel({ ...instant, decay: 1 }, 0.5)).toBeCloseTo(0.65);
  });

  it('releases from the level of the sustain to 0 in the release time', () => {
    expect(envelopeValue(env, 2, 2)).toBe(0.5);
    expect(envelopeValue(env, 2.5, 2)).toBeCloseTo(0.25);
    expect(envelopeValue(env, 3, 2)).toBe(0);
    expect(envelopeValue(env, 10, 2)).toBe(0);
  });

  it('releases from the attack and the decay at the level it has reached, in the same time', () => {
    // released at half the attack: from 0.5
    expect(envelopeValue(env, 0.05, 0.05)).toBeCloseTo(0.5);
    expect(envelopeValue(env, 0.55, 0.05)).toBeCloseTo(0.25);
    expect(envelopeValue(env, 1.05, 0.05)).toBe(0);
    // released in the decay at 0.75
    expect(envelopeValue(env, 0.5, 0.5)).toBeCloseTo(0.75);
    expect(envelopeValue(env, 1, 0.5)).toBeCloseTo(0.375);
    // released before its start: silent
    expect(envelopeValue(env, 0, -1)).toBe(0);
  });

  it('started again from a level: the attack from there to 1 in its time, the stages after it as before', () => {
    expect(envelopeLevel(env, 0, 0.6)).toBe(0.6);
    expect(envelopeLevel(env, 0.05, 0.6)).toBeCloseTo(0.8);
    expect(envelopeLevel(env, 0.1, 0.6)).toBe(1);
    expect(envelopeLevel(env, 0.5, 0.6)).toBeCloseTo(0.75);
    // released in the attack: from the level it has
    expect(envelopeValue(env, 0.55, 0.05, 0.6)).toBeCloseTo(0.4);
    // just before its start, its level
    expect(envelopeValueBefore(env, 0, Infinity, 0.6)).toBe(0.6);
    expect(envelopeValueBefore(env, 0.05, Infinity, 0.6)).toBeCloseTo(0.8);
    // no attack: a step to 1
    expect(envelopeLevel({ ...env, attack: 0 }, 0, 0.6)).toBe(1);
  });

  it('ends at once with a release of 0', () => {
    const cut = { ...env, release: 0 };
    expect(envelopeValue(cut, 1, 1)).toBe(0);
    expect(envelopeValue(cut, 0.999, 1)).toBe(0.5);
  });

  describe('stages', () => {
    it('gives the value, the slope and the end of each stage', () => {
      expect(stage(env, -1)).toEqual([0, 0, 0]);
      const [attack, slope, end] = stage(env, 0.05);
      expect([attack, slope, end]).toEqual([expect.closeTo(0.5), expect.closeTo(10), 0.1]);
      expect(stage(env, 0.2)).toEqual([1, 0, expect.closeTo(0.3)]);
      expect(stage(env, 0.5)).toEqual([expect.closeTo(0.75), expect.closeTo(-1.25), expect.closeTo(0.7)]);
      expect(stage(env, 5)).toEqual([0.5, 0, Infinity]);
    });

    it('ends a held stage at the release, the release at its end', () => {
      expect(stage(env, 5, 6)).toEqual([0.5, 0, 6]);
      expect(stage(env, 0.2, 0.25)).toEqual([1, 0, 0.25]);
      expect(stage(env, 6.5, 6)).toEqual([expect.closeTo(0.25), -0.5, 7]);
      expect(stage(env, 7, 6)).toEqual([0, 0, Infinity]);
    });

    it('matches the values in every stage, also started again from a level', () => {
      for (const from of [0, 0.3, 1])
        for (const releasedAt of [Infinity, 0.05, 0.2, 0.5, 2]) {
          for (let t = -0.1; t < 4; t += 0.013) {
            const [value, slope, end] = stage(env, t, releasedAt, from);
            expect(value).toBeCloseTo(envelopeValue(env, t, releasedAt, from), 9);
            // linear up to its end
            const next = Math.min(end, t + 0.01);
            if (next > t)
              expect(value + slope * (next - t)).toBeCloseTo(
                envelopeValue(env, next - 1e-12, releasedAt, from),
                6
              );
          }
        }
    });
  });

  describe('curves', () => {
    const curved: EnvelopeParams = { ...env, curves: { attack: -2, decay: 3.49, release: 3.49 } };

    it('shapes a stage by (1 - e^(-kx)) / (1 - e^(-k)): from its start to its end, a line at k 0', () => {
      [-5, -1, 0.5, 3.49, 8].forEach((k) => {
        expect(curveShape(k, 0)).toBeCloseTo(0, 15);
        expect(curveShape(k, 1)).toBeCloseTo(1, 12);
      });
      expect(curveShape(0, 0.3)).toBe(0.3);
      // k > 0 moves fast at first, k < 0 slowly; a curve and its mirror add up to a line
      expect(curveShape(3.49, 0.1)).toBeGreaterThan(0.3);
      expect(curveShape(-3.49, 0.1)).toBeLessThan(0.05);
      expect(curveShape(3.49, 0.3) + curveShape(-3.49, 0.7)).toBeCloseTo(1, 12);
    });

    it('curves the attack, the decay and the release, the corners where they were', () => {
      expect(envelopeLevel(curved, 0.05)).toBeCloseTo(curveShape(-2, 0.5), 12);
      expect(envelopeLevel(curved, 0.1)).toBe(1);
      expect(envelopeLevel(curved, 0.5)).toBeCloseTo(1 - 0.5 * curveShape(3.49, 0.5), 12);
      expect(envelopeLevel(curved, 0.7)).toBe(0.5);
      // released in the decay: from the level reached there to 0, curved
      const level = envelopeLevel(curved, 0.5);
      expect(envelopeValue(curved, 0.8, 0.5)).toBeCloseTo(level * (1 - curveShape(3.49, 0.3)), 12);
      expect(envelopeValue(curved, 1.5, 0.5)).toBe(0);
      // the attack again from a level (mono): from it to 1 in the attack, curved
      expect(envelopeLevel(curved, 0.05, 0.4)).toBeCloseTo(0.4 + 0.6 * curveShape(-2, 0.5), 12);
    });

    it('is the same before a corner as at it, but where it steps', () => {
      [0.05, 0.3, 0.5].forEach((t) => expect(envelopeValueBefore(curved, t)).toBe(envelopeValue(curved, t)));
      expect(envelopeValueBefore(curved, 0.8, 0.5)).toBe(envelopeValue(curved, 0.8, 0.5));
    });

    it('tells a curved stage (the automation of a knob cuts it into lines)', () => {
      expect(curvedAt(env, 0.5)).toBe(false);
      expect(curvedAt(curved, -0.1)).toBe(false);
      expect(curvedAt(curved, 0.05)).toBe(true);
      expect(curvedAt(curved, 0.2)).toBe(false);
      expect(curvedAt(curved, 0.5)).toBe(true);
      expect(curvedAt(curved, 0.8)).toBe(false);
      expect(curvedAt(curved, 0.8, 0.5)).toBe(true);
      expect(curvedAt(curved, 1.6, 0.5)).toBe(false);
      expect(curvedAt({ ...curved, curves: { attack: 0, decay: 0, release: 3 } }, 0.5)).toBe(false);
    });

    it('works a linear stage out as without curves, to the bit (the linear voices)', () => {
      const linear = { ...env, curves: { attack: 0, decay: 0, release: 0 } };
      [0.03, 0.15, 0.45, 0.9].forEach((t) => {
        expect(envelopeLevel(linear, t)).toBe(envelopeLevel(env, t));
        expect(envelopeValue(linear, t + 0.4, 0.4)).toBe(envelopeValue(env, t + 0.4, 0.4));
      });
    });

    // the renders of scripts/renders/run.mjs: the levels every 10 ms of stages of 1 s at its curves.
    // The exponential of k fits them: 50% a line, 66.6% (the default of the decay and the release) 3.49, 75% 5.41,
    // 25% -5.41
    const measurements = JSON.parse(
      readFileSync(join(__dirname, '../../../../../../../dsp/measurements/envelopes.json'), 'utf8')
    );
    it.each([
      ['0.5', 0],
      ['0.666', 3.49],
      ['0.75', 5.41],
      ['0.25', -5.41],
    ])('follows the measured levels at the curve %s within 1%%', (curve, k) => {
      const shape: EnvelopeParams = {
        attack: 1,
        hold: 0,
        decay: 1,
        sustain: measurements.sustain,
        release: 1,
        curves: { attack: k, decay: k, release: k },
      };
      const measured = measurements.curves[curve];
      // each value is the level of the 10 ms from its time on: the middle of its window, the first and the last
      // window cross a corner
      const at = (k: number) => k / 100 + 0.005;
      for (let i = 1; i < 99; i++) {
        expect(Math.abs(measured.attack[i] - envelopeLevel(shape, at(i)))).toBeLessThan(0.01);
        expect(Math.abs(measured.decay[i] - envelopeLevel(shape, 1 + at(i)))).toBeLessThan(0.01);
        expect(Math.abs(measured.release[i] - envelopeValue(shape, 2.5 + at(i), 2.5))).toBeLessThan(0.01);
      }
    });
  });
});
