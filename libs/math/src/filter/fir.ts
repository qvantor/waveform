// the modified Bessel function of the first kind, order 0 (the Kaiser window)
const besselI0 = (x: number) => {
  let sum = 1;
  let term = 1;
  for (let k = 1; term > sum * 1e-16; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
};

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

// the ideal lowpass (sinc, x in samples) cut at `cutoff` × the nyquist in a Kaiser window of halfWidth
// samples on each side, 0 from there on: the taps of interpolators and decimators. A larger beta lowers the
// sidelobes (the stopband) and widens the transition band, which lies around the cut (as wide as the window
// allows). Cut at the nyquist (1) it is 0 at the whole samples but the center: phase 0 of an interpolator is
// the input itself
export const kaiserSinc = (x: number, halfWidth: number, beta: number, cutoff = 1) => {
  if (x <= -halfWidth || x >= halfWidth) return 0;
  const r = x / halfWidth;
  return (cutoff * sinc(cutoff * x) * besselI0(beta * Math.sqrt(1 - r * r))) / besselI0(beta);
};

// phase p (0..factor - 1) of a polyphase interpolator by `factor` (kaiserSinc of taps/2 samples on each side):
// it reads the point p/factor of a sample after the center (the sample written taps/2 steps ago), tap j
// weighs the sample written j steps ago, which is j - taps/2 + p/factor samples before that point.
// The taps sum to 1, so DC passes exactly
export const sincPhase = (phase: number, factor: number, taps: number, beta: number, cutoff = 1) => {
  const center = taps / 2;
  const kernel = Float64Array.from({ length: taps }, (_, j) =>
    kaiserSinc(j - center + phase / factor, center, beta, cutoff)
  );
  const sum = kernel.reduce((a, b) => a + b);
  return kernel.map((tap) => tap / sum);
};
