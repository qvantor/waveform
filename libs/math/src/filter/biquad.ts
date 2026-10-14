export type Coefficients = [b0: number, b1: number, b2: number, a1: number, a2: number];

export interface BiquadParams {
  frequency: number;
  // lowpass and highpass: in dB, the others: linear, shelves don't use it
  Q: number;
  // dB, peaking and shelves only
  gain: number;
}

const constant = (value: number): Coefficients => [value, 0, 0, 0, 0];

const normalize = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Coefficients => [
  b0 / a0,
  b1 / a0,
  b2 / a0,
  a1 / a0,
  a2 / a0,
];

// BiquadFilterNode coefficients as defined by the Web Audio API spec (Audio EQ Cookbook),
// including the edge cases browsers use at 0 Hz, at nyquist and for Q <= 0
export const coefficients = (
  type: BiquadFilterType,
  { frequency, Q, gain }: BiquadParams,
  sampleRate: number
): Coefficients => {
  const f = frequency / (sampleRate / 2);
  const A = Math.pow(10, gain / 40);
  const inside = f > 0 && f < 1;
  const w0 = Math.PI * f;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Q);
  // Q of lowpass and highpass is in dB
  const alphaDb = sin / (2 * Math.pow(10, Q / 20));
  // shelf slope S = 1, Q is not used
  const k = 2 * Math.sqrt(A) * (sin / Math.SQRT2);

  switch (type) {
    case 'lowpass':
      if (f >= 1) return constant(1);
      if (f <= 0) return constant(0);
      return normalize((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alphaDb, -2 * cos, 1 - alphaDb);
    case 'highpass':
      if (f >= 1) return constant(0);
      if (f <= 0) return constant(1);
      return normalize((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alphaDb, -2 * cos, 1 - alphaDb);
    case 'bandpass':
      if (!inside) return constant(0);
      if (Q <= 0) return constant(1);
      return normalize(alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha);
    case 'notch':
      if (!inside) return constant(1);
      if (Q <= 0) return constant(0);
      return normalize(1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha);
    case 'allpass':
      if (!inside) return constant(1);
      if (Q <= 0) return constant(-1);
      return normalize(1 - alpha, -2 * cos, 1 + alpha, 1 + alpha, -2 * cos, 1 - alpha);
    case 'peaking':
      if (!inside) return constant(1);
      if (Q <= 0) return constant(A * A);
      return normalize(1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A);
    case 'lowshelf':
      if (f >= 1) return constant(A * A);
      if (f <= 0) return constant(1);
      return normalize(
        A * (A + 1 - (A - 1) * cos + k),
        2 * A * (A - 1 - (A + 1) * cos),
        A * (A + 1 - (A - 1) * cos - k),
        A + 1 + (A - 1) * cos + k,
        -2 * (A - 1 + (A + 1) * cos),
        A + 1 + (A - 1) * cos - k
      );
    case 'highshelf':
      if (f >= 1) return constant(1);
      if (f <= 0) return constant(A * A);
      return normalize(
        A * (A + 1 + (A - 1) * cos + k),
        -2 * A * (A - 1 + (A + 1) * cos),
        A * (A + 1 + (A - 1) * cos - k),
        A + 1 - (A - 1) * cos + k,
        2 * (A - 1 - (A + 1) * cos),
        A + 1 - (A - 1) * cos - k
      );
    default:
      return constant(1);
  }
};

// |H(e^jw)| in dB at `freq`: (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
export const magnitudeDb = ([b0, b1, b2, a1, a2]: Coefficients, freq: number, sampleRate: number) => {
  const w = (2 * Math.PI * freq) / sampleRate;
  const [cos1, sin1, cos2, sin2] = [Math.cos(w), Math.sin(w), Math.cos(2 * w), Math.sin(2 * w)];
  const numRe = b0 + b1 * cos1 + b2 * cos2;
  const numIm = -(b1 * sin1 + b2 * sin2);
  const denRe = 1 + a1 * cos1 + a2 * cos2;
  const denIm = -(a1 * sin1 + a2 * sin2);
  return 10 * Math.log10((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
};
