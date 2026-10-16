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

  it('is cut at the nyquist unless told otherwise: a cutoff of 1 gives the same taps', () => {
    [0, 0.25, 0.5, 3.75, 10.1, 15.9].forEach((x) =>
      expect(kaiserSinc(x, HALF_WIDTH, BETA, 1)).toBe(kaiserSinc(x, HALF_WIDTH, BETA))
    );
  });

  it('cut below the nyquist it is lower and wider: no longer 0 at the whole samples', () => {
    expect(kaiserSinc(0, HALF_WIDTH, BETA, 0.9)).toBeCloseTo(0.9, 14);
    expect(Math.abs(kaiserSinc(1, HALF_WIDTH, BETA, 0.9))).toBeGreaterThan(0.05);
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

  it('phase 0 cut at the nyquist is the center sample alone', () => {
    sincPhase(0, 4, TAPS, BETA).forEach((tap, j) => expect(tap).toBeCloseTo(j === TAPS / 2 ? 1 : 0, 14));
  });

  // the 4 phases together: the lowpass of the 4× rate after zero stuffing, at f (cycles per sample of the
  // input, up to 2: the nyquist of the 4× rate); an input tone at f has its images at 1 - f, 1 + f, 2 - f
  const response = (cutoff: number, f: number) => {
    let re = 0;
    let im = 0;
    [0, 1, 2, 3].forEach((phase) =>
      sincPhase(phase, 4, TAPS, BETA, cutoff).forEach((tap, j) => {
        const x = j - TAPS / 2 + phase / 4;
        re += tap * Math.cos(2 * Math.PI * f * x);
        im -= tap * Math.sin(2 * Math.PI * f * x);
      })
    );
    return 20 * Math.log10(Math.hypot(re, im) / 4);
  };

  it('cut below the nyquist every phase sums to 1, phase 0 too', () => {
    [0, 1, 2, 3].forEach((phase) =>
      expect(sincPhase(phase, 4, TAPS, BETA, 0.9).reduce((a, b) => a + b)).toBeCloseTo(1, 14)
    );
  });

  it('cut at the nyquist an interpolator passes half of the images at the nyquist', () => {
    expect(response(1, 0.45)).toBeGreaterThan(-0.05);
    expect(response(1, 0.5)).toBeCloseTo(-6.02, 1);
  });

  it('cut at 0.9 it is flat up to 0.4·fs and stops everything from the nyquist up', () => {
    [0.1, 0.2, 0.3, 0.4].forEach((f) => expect(Math.abs(response(0.9, f))).toBeLessThan(0.05));
    for (let f = 0.5; f <= 2; f += 0.005) expect(response(0.9, f)).toBeLessThan(-50);
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
