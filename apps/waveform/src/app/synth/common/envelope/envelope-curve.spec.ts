import { EnvelopeParams, envelopeLevel, envelopeStage, envelopeValue } from './envelope-curve';

const env: EnvelopeParams = { attack: 0.1, hold: 0.2, decay: 0.4, sustain: 0.5, release: 1 };

const stage = (params: EnvelopeParams, t: number, releasedAt = Infinity) =>
  Array.from(envelopeStage(params, t, releasedAt, new Float64Array(3)));

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

    it('matches the values in every stage', () => {
      for (const releasedAt of [Infinity, 0.05, 0.2, 0.5, 2]) {
        for (let t = -0.1; t < 4; t += 0.013) {
          const [value, slope, end] = stage(env, t, releasedAt);
          expect(value).toBeCloseTo(envelopeValue(env, t, releasedAt), 9);
          // linear up to its end
          const next = Math.min(end, t + 0.01);
          if (next > t)
            expect(value + slope * (next - t)).toBeCloseTo(envelopeValue(env, next - 1e-12, releasedAt), 6);
        }
      }
    });
  });
});
