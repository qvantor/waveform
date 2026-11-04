import { eraIndex, REVERB_ERAS, tube, TUBE_RANGE } from './reverb-era';

// amplitudes of the first harmonics of a sine through the tube
const harmonics = (drive: number, amplitude: number, count = 3) => {
  const n = 1024;
  const out = Array.from({ length: n }, (_, i) => tube(amplitude * Math.sin((2 * Math.PI * i) / n), drive));
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

describe('tube', () => {
  it('without drive passes the input unchanged, clipped to its range', () => {
    [0, 0.001, 0.3, -2.5, 7].forEach((x) => expect(tube(x, 0)).toBe(x));
    expect(tube(9, 0)).toBe(TUBE_RANGE);
    expect(tube(-20, 0)).toBe(-TUBE_RANGE);
  });

  it.each([0.15, 1, 3])('drive %p: silence stays silent, quiet signals pass unchanged, it rises', (drive) => {
    expect(tube(0, drive)).toBe(0);
    // unity slope at 0: the level doesn't jump with the era
    expect(tube(0.001, drive) / 0.001).toBeCloseTo(1, 2);
    expect(tube(-0.001, drive) / -0.001).toBeCloseTo(1, 2);
    // never falls, rises over the working range (far out the tanh is flat in double precision)
    for (let x = -TUBE_RANGE; x < TUBE_RANGE; x += 0.25) {
      expect(tube(x + 0.25, drive)).toBeGreaterThanOrEqual(tube(x, drive));
    }
    [-2, -1, 0, 1, 2].forEach((x) => expect(tube(x + 0.01, drive)).toBeGreaterThan(tube(x, drive)));
  });

  // the era glides the drive: the curve has to bend into the straight line without a jump
  it('a vanishing drive becomes the straight line continuously', () => {
    [-3, -0.5, 0.5, 3].forEach((x) => {
      expect(tube(x, 1e-3)).toBeCloseTo(x, 2);
      expect(Math.abs(tube(x, 1e-4) - tube(x, 0))).toBeLessThan(5e-3);
    });
  });

  it('is asymmetric: the positive half is compressed more', () => {
    expect(tube(2, REVERB_ERAS[2].drive)).toBeLessThan(-tube(-2, REVERB_ERAS[2].drive));
  });

  // synth chords peak at 1..3: a hint of 2nd harmonic there, almost nothing on quiet tails,
  // so chords don't turn into intermodulation whistles
  it('70s: a subtle 2nd harmonic at synth levels, the level stays', () => {
    const { drive } = REVERB_ERAS[2];
    const [fundamental, second, third] = harmonics(drive, 1.5);
    expect(db(fundamental / 1.5)).toBeGreaterThan(-0.5);
    expect(db(second / fundamental)).toBeGreaterThan(-36);
    expect(db(second / fundamental)).toBeLessThan(-26);
    expect(db(third / fundamental)).toBeLessThan(-45);
    const [quiet, quietSecond] = harmonics(drive, 0.2);
    expect(db(quietSecond / quiet)).toBeLessThan(-45);
  });

  it('more drive gives more harmonics', () => {
    const [, light] = harmonics(0.15, 1.5);
    const [, heavy] = harmonics(1, 1.5);
    expect(heavy).toBeGreaterThan(light * 2);
  });

  it('now adds no harmonics', () => {
    const [fundamental, second, third] = harmonics(0, 0.5);
    expect(fundamental).toBeCloseTo(0.5, 5);
    expect(second).toBeLessThan(1e-6);
    expect(third).toBeLessThan(1e-6);
  });
});
