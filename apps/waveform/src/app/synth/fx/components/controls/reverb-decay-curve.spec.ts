import { HF_RATIO } from '../../effects/reverb-decay';
import { DECAY_CHART_FREQS, decayCurve } from './reverb-decay-curve';

const params = { size: 0.5, decay: 2, damp: 20000, bass: 1 };
const at = (curve: [number, number][], freq: number) =>
  curve.reduce((best, point) => (Math.abs(point[0] - freq) < Math.abs(best[0] - freq) ? point : best))[1];

describe('decayCurve', () => {
  it('covers 20 Hz..20 kHz', () => {
    const curve = decayCurve(params, 48000);
    expect(curve.map(([freq]) => freq)).toEqual(DECAY_CHART_FREQS);
    expect(curve[0][0]).toBe(20);
    expect(curve[curve.length - 1][0]).toBeCloseTo(20000);
  });

  it('is flat at the decay time with bass 1 and no damping in the audible range', () => {
    const curve = decayCurve(params, 48000);
    expect(at(curve, 100)).toBeCloseTo(2, 1);
    expect(at(curve, 1000)).toBeCloseTo(2, 1);
  });

  it('bass lifts the lows below the crossover', () => {
    const curve = decayCurve({ ...params, bass: 3 }, 48000);
    expect(at(curve, 20)).toBeCloseTo(6, 0);
    expect(at(curve, 5000)).toBeCloseTo(2, 1);
  });

  it('the highs fall off above hi damp', () => {
    const curve = decayCurve({ ...params, damp: 1000 }, 48000);
    expect(at(curve, 100)).toBeCloseTo(2, 1);
    expect(at(curve, 15000)).toBeCloseTo(2 * HF_RATIO, 1);
    const values = curve.map(([, seconds]) => seconds);
    values.slice(1).forEach((value, i) => expect(value).toBeLessThanOrEqual(values[i] + 1e-9));
  });
});
