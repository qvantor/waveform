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

// the ideal lowpass cut at the nyquist (sinc, x in samples) in a Kaiser window of halfWidth samples on each
// side, 0 from there on: the taps of interpolators and decimators. A larger beta lowers the sidelobes
// (the stopband) and widens the transition band
export const kaiserSinc = (x: number, halfWidth: number, beta: number) => {
  if (x <= -halfWidth || x >= halfWidth) return 0;
  const r = x / halfWidth;
  return (sinc(x) * besselI0(beta * Math.sqrt(1 - r * r))) / besselI0(beta);
};

// phase p (1..factor - 1) of a polyphase interpolator by `factor` (kaiserSinc of taps/2 samples on each side):
// it reads the point p/factor of a sample after the center (the sample written taps/2 steps ago), tap j
// weighs the sample written j steps ago, which is j - taps/2 + p/factor samples before that point.
// The taps sum to 1, so DC passes exactly
export const sincPhase = (phase: number, factor: number, taps: number, beta: number) => {
  const center = taps / 2;
  const kernel = Float64Array.from({ length: taps }, (_, j) =>
    kaiserSinc(j - center + phase / factor, center, beta)
  );
  const sum = kernel.reduce((a, b) => a + b);
  return kernel.map((tap) => tap / sum);
};
