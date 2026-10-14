import { eraIndex, REVERB_ERAS, tubeCurve, TUBE_CURVE_LENGTH, TUBE_RANGE } from './reverb-era';

const MIDDLE = (TUBE_CURVE_LENGTH - 1) / 2;

// the waveshaper: the input is scaled to -1..1 of the curve and interpolated linearly
const shape = (curve: Float32Array, x: number) => {
  const pos = ((x / TUBE_RANGE + 1) * (curve.length - 1)) / 2;
  const i = Math.min(curve.length - 2, Math.max(0, Math.floor(pos)));
  return curve[i] + (curve[i + 1] - curve[i]) * (pos - i);
};

// amplitudes of the first harmonics of a sine through the curve
const harmonics = (curve: Float32Array, amplitude: number, count = 3) => {
  const n = 1024;
  const out = Array.from({ length: n }, (_, i) => shape(curve, amplitude * Math.sin((2 * Math.PI * i) / n)));
  return Array.from({ length: count }, (_, h) => {
    const [re, im] = out.reduce(
      ([sumRe, sumIm], y, i) => {
        const phase = (2 * Math.PI * (h + 1) * i) / n;
        return [sumRe + y * Math.cos(phase), sumIm + y * Math.sin(phase)];
      },
      [0, 0]
    );
    return (2 * Math.hypot(re, im)) / n;
  });
};
const db = (ratio: number) => 20 * Math.log10(ratio);

describe('reverb eras', () => {
  it('goes from the clean now to the 70s', () => {
    expect(REVERB_ERAS.map(({ id, label }) => [id, label])).toEqual([
      ['now', 'Now'],
      ['80s', '80s'],
      ['70s', '70s'],
    ]);
    expect(REVERB_ERAS[0]).toMatchObject({ drive: 0, bandwidth: null, body: 0 });
  });

  it('the older the era, the more body and the narrower the band, only the 70s drive the tube', () => {
    const [, eighties, seventies] = REVERB_ERAS;
    expect(eighties.drive).toBe(0);
    expect(seventies.drive).toBeGreaterThan(0);
    expect(seventies.body).toBeGreaterThan(eighties.body);
    expect(eighties.body).toBeGreaterThan(0);
    expect(seventies.bandwidth).toBeLessThan(eighties.bandwidth ?? 0);
  });

  it.each([
    [-1, 0],
    [0, 0],
    [0.6, 1],
    [1.4, 1],
    [2, 2],
    [5, 2],
  ])('eraIndex(%p) is %p', (value, index) => {
    expect(eraIndex(value)).toBe(index);
  });
});

describe('tubeCurve', () => {
  it('without drive is a straight line over the whole range', () => {
    const curve = tubeCurve(0);
    expect(curve).toHaveLength(TUBE_CURVE_LENGTH);
    expect(curve[0]).toBe(-TUBE_RANGE);
    expect(curve[MIDDLE]).toBe(0);
    expect(curve[TUBE_CURVE_LENGTH - 1]).toBe(TUBE_RANGE);
    [0.001, 0.3, -2.5, 7].forEach((x) => expect(shape(curve, x)).toBeCloseTo(x, 5));
  });

  it.each([0.15, 1, 3])(
    'drive %p: silence stays silent, quiet signals pass unchanged, the curve rises',
    (drive) => {
      const curve = tubeCurve(drive);
      expect(TUBE_CURVE_LENGTH % 2).toBe(1);
      expect(curve[MIDDLE]).toBe(0);
      // unity slope at 0: the level doesn't jump with the era
      expect(shape(curve, 0.001) / 0.001).toBeCloseTo(1, 2);
      expect(shape(curve, -0.001) / -0.001).toBeCloseTo(1, 2);
      // never falls, rises over the working range (far out the tanh is flat in float32)
      curve.slice(1).forEach((value, i) => expect(value).toBeGreaterThanOrEqual(curve[i]));
      [-2, -1, 0, 1, 2].forEach((x) => expect(shape(curve, x + 0.01)).toBeGreaterThan(shape(curve, x)));
    }
  );

  it('is asymmetric: the positive half is compressed more', () => {
    const curve = tubeCurve(REVERB_ERAS[2].drive);
    expect(shape(curve, 2)).toBeLessThan(-shape(curve, -2));
  });

  // synth chords peak at 1..3: a hint of 2nd harmonic there, almost nothing on quiet tails,
  // so chords don't turn into intermodulation whistles
  it('70s: a subtle 2nd harmonic at synth levels, the level stays', () => {
    const curve = tubeCurve(REVERB_ERAS[2].drive);
    const [fundamental, second, third] = harmonics(curve, 1.5);
    expect(db(fundamental / 1.5)).toBeGreaterThan(-0.5);
    expect(db(second / fundamental)).toBeGreaterThan(-36);
    expect(db(second / fundamental)).toBeLessThan(-26);
    expect(db(third / fundamental)).toBeLessThan(-45);
    const [quiet, quietSecond] = harmonics(curve, 0.2);
    expect(db(quietSecond / quiet)).toBeLessThan(-45);
  });

  it('more drive gives more harmonics', () => {
    const [, light] = harmonics(tubeCurve(0.15), 1.5);
    const [, heavy] = harmonics(tubeCurve(1), 1.5);
    expect(heavy).toBeGreaterThan(light * 2);
  });

  it('now adds no harmonics', () => {
    const [fundamental, second, third] = harmonics(tubeCurve(0), 0.5);
    expect(fundamental).toBeCloseTo(0.5, 5);
    expect(second).toBeLessThan(1e-6);
    expect(third).toBeLessThan(1e-6);
  });
});
