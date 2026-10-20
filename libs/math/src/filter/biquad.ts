export type Coefficients = [b0: number, b1: number, b2: number, a1: number, a2: number];

export interface BiquadParams {
  frequency: number;
  // lowpass and highpass: in dB, the others: linear, shelves don't use it
  Q: number;
  // dB, peaking and shelves only
  gain: number;
}

// the coefficients go into an array of 5 (a typed one in an audio worklet: nothing to collect)
type Out = number[] | Float64Array;

const write = <T extends Out>(out: T, b0: number, b1: number, b2: number, a1: number, a2: number) => {
  out[0] = b0;
  out[1] = b1;
  out[2] = b2;
  out[3] = a1;
  out[4] = a2;
  return out;
};

const constant = <T extends Out>(out: T, value: number) => write(out, value, 0, 0, 0, 0);

const normalize = <T extends Out>(
  out: T,
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number
) => write(out, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);

// BiquadFilterNode coefficients as defined by the Web Audio API spec (Audio EQ Cookbook),
// including the edge cases browsers use at 0 Hz, at nyquist and for Q <= 0; into `out`, returned
export const coefficientsInto = <T extends Out>(
  out: T,
  type: BiquadFilterType,
  { frequency, Q, gain }: BiquadParams,
  sampleRate: number
): T => {
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
      if (f >= 1) return constant(out, 1);
      if (f <= 0) return constant(out, 0);
      return normalize(out, (1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alphaDb, -2 * cos, 1 - alphaDb);
    case 'highpass':
      if (f >= 1) return constant(out, 0);
      if (f <= 0) return constant(out, 1);
      return normalize(out, (1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alphaDb, -2 * cos, 1 - alphaDb);
    case 'bandpass':
      if (!inside) return constant(out, 0);
      if (Q <= 0) return constant(out, 1);
      return normalize(out, alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha);
    case 'notch':
      if (!inside) return constant(out, 1);
      if (Q <= 0) return constant(out, 0);
      return normalize(out, 1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha);
    case 'allpass':
      if (!inside) return constant(out, 1);
      if (Q <= 0) return constant(out, -1);
      return normalize(out, 1 - alpha, -2 * cos, 1 + alpha, 1 + alpha, -2 * cos, 1 - alpha);
    case 'peaking':
      if (!inside) return constant(out, 1);
      if (Q <= 0) return constant(out, A * A);
      return normalize(out, 1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A);
    case 'lowshelf':
      if (f >= 1) return constant(out, A * A);
      if (f <= 0) return constant(out, 1);
      return normalize(
        out,
        A * (A + 1 - (A - 1) * cos + k),
        2 * A * (A - 1 - (A + 1) * cos),
        A * (A + 1 - (A - 1) * cos - k),
        A + 1 + (A - 1) * cos + k,
        -2 * (A - 1 + (A + 1) * cos),
        A + 1 + (A - 1) * cos - k
      );
    case 'highshelf':
      if (f >= 1) return constant(out, 1);
      if (f <= 0) return constant(out, A * A);
      return normalize(
        out,
        A * (A + 1 + (A - 1) * cos + k),
        -2 * A * (A - 1 + (A + 1) * cos),
        A * (A + 1 + (A - 1) * cos - k),
        A + 1 - (A - 1) * cos + k,
        2 * (A - 1 - (A + 1) * cos),
        A + 1 - (A - 1) * cos - k
      );
    default:
      return constant(out, 1);
  }
};

export const coefficients = (type: BiquadFilterType, params: BiquadParams, sampleRate: number) =>
  coefficientsInto([0, 0, 0, 0, 0] as Coefficients, type, params, sampleRate);

// |H(e^jw)| in dB from the terms of z = e^jw (cos w, sin w, cos 2w, sin 2w): a chart reads the response at the
// same frequencies every frame, it works them out once. (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
export const magnitudeDbAt = (c: Coefficients, cos1: number, sin1: number, cos2: number, sin2: number) => {
  const numRe = c[0] + c[1] * cos1 + c[2] * cos2;
  const numIm = -(c[1] * sin1 + c[2] * sin2);
  const denRe = 1 + c[3] * cos1 + c[4] * cos2;
  const denIm = -(c[3] * sin1 + c[4] * sin2);
  return 10 * Math.log10((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
};

// |H(e^jw)| in dB at `freq`
export const magnitudeDb = (c: Coefficients, freq: number, sampleRate: number) => {
  const w = (2 * Math.PI * freq) / sampleRate;
  return magnitudeDbAt(c, Math.cos(w), Math.sin(w), Math.cos(2 * w), Math.sin(2 * w));
};
