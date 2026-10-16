import { kaiserSinc, sincPhase } from './fir';

const HALF_WIDTH = 16;
const BETA = 5;

describe('kaiserSinc', () => {
  it('is 1 at the center and 0 at the other whole samples (an interpolator passes the samples)', () => {
    expect(kaiserSinc(0, HALF_WIDTH, BETA)).toBe(1);
    for (let x = 1; x < HALF_WIDTH; x++) {
      expect(kaiserSinc(x, HALF_WIDTH, BETA)).toBeCloseTo(0, 14);
      expect(kaiserSinc(-x, HALF_WIDTH, BETA)).toBeCloseTo(0, 14);
    }
  });

  it('is symmetric', () => {
    [0.25, 0.5, 3.75, 10.1, 15.9].forEach((x) =>
      expect(kaiserSinc(-x, HALF_WIDTH, BETA)).toBe(kaiserSinc(x, HALF_WIDTH, BETA))
    );
  });

  it('is 0 from the half width on', () => {
    [HALF_WIDTH, -HALF_WIDTH, HALF_WIDTH + 0.5, -100].forEach((x) =>
      expect(kaiserSinc(x, HALF_WIDTH, BETA)).toBe(0)
    );
  });

  it('beta 0 is the plain sinc', () => {
    expect(kaiserSinc(0.5, HALF_WIDTH, 0)).toBeCloseTo(2 / Math.PI, 14);
  });

  it('the window tapers the sinc towards the edges', () => {
    const plain = (x: number) => Math.sin(Math.PI * x) / (Math.PI * x);
    expect(Math.abs(kaiserSinc(0.5, HALF_WIDTH, BETA) / plain(0.5))).toBeGreaterThan(0.99);
    expect(Math.abs(kaiserSinc(15.5, HALF_WIDTH, BETA) / plain(15.5))).toBeLessThan(0.1);
  });
});

describe('sincPhase', () => {
  const TAPS = 32;

  it('sums to 1, so DC passes exactly', () => {
    [1, 2, 3].forEach((phase) =>
      expect(sincPhase(phase, 4, TAPS, BETA).reduce((a, b) => a + b)).toBeCloseTo(1, 14)
    );
  });

  it('weighs the samples around the point it reads, the nearest ones the most', () => {
    const taps = Array.from(sincPhase(1, 4, TAPS, BETA));
    const loudest = taps.indexOf(Math.max(...taps));
    // the point is a quarter sample after the center: the sample written TAPS / 2 steps ago is the nearest
    expect(loudest).toBe(TAPS / 2);
  });

  it('the half sample phase is symmetric, the quarter phases mirror each other', () => {
    const half = sincPhase(2, 4, TAPS, BETA);
    const quarter = sincPhase(1, 4, TAPS, BETA);
    const threeQuarters = sincPhase(3, 4, TAPS, BETA);
    // phase 2 reads x = j - 15.5 for j = 0..31: tap j and tap 31 - j are the same distance away
    for (let j = 0; j < TAPS; j++) {
      expect(half[j]).toBeCloseTo(half[TAPS - 1 - j], 15);
      // phase 1 reads j - 15.75, phase 3 reads j - 15.25: tap j of one is tap 31 - j of the other
      expect(quarter[j]).toBeCloseTo(threeQuarters[TAPS - 1 - j], 15);
    }
  });

  it('interpolates a slow sine between its samples', () => {
    const f = 0.05;
    const taps = sincPhase(2, 4, TAPS, BETA);
    // the sample written j steps ago is at time -j, the point read is half a sample after -TAPS / 2
    const y = taps.reduce((sum, tap, j) => sum + tap * Math.sin(2 * Math.PI * f * -j), 0);
    // within the ripple of the window (0.03 dB)
    expect(Math.abs(y - Math.sin(2 * Math.PI * f * (-TAPS / 2 + 0.5)))).toBeLessThan(0.0035);
  });
});
