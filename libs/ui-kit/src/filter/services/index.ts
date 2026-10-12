import { FilterProps } from '../types';

type ChartArray = [number, number][];

type Coefficients = [b0: number, b1: number, b2: number, a1: number, a2: number];

export const MIN_FREQ = 10;
export const MAX_FREQ = 20000;
export const DB_RANGE = 48;

const POINTS = 256;

// trig terms of z = e^{jw} for one frequency, they depend only on the frequency and the sample rate
type Point = { freq: number; cos1: number; sin1: number; cos2: number; sin2: number };

const point = (freq: number, sampleRate: number): Point => {
  const w = (2 * Math.PI * freq) / sampleRate;
  return { freq, cos1: Math.cos(w), sin1: Math.sin(w), cos2: Math.cos(2 * w), sin2: Math.sin(2 * w) };
};

// log-spaced grid up to nyquist: above it the response folds back and isn't heard
const grids = new Map<number, Point[]>();
const getGrid = (sampleRate: number) => {
  let grid = grids.get(sampleRate);
  if (!grid) {
    const maxFreq = Math.min(MAX_FREQ, sampleRate / 2);
    grid = Array.from({ length: POINTS }, (_, i) =>
      point(MIN_FREQ * Math.pow(maxFreq / MIN_FREQ, i / (POINTS - 1)), sampleRate)
    );
    grids.set(sampleRate, grid);
  }
  return grid;
};

const constant = (value: number): Coefficients => [value, 0, 0, 0, 0];

const normalize = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Coefficients => [
  b0 / a0,
  b1 / a0,
  b2 / a0,
  a1 / a0,
  a2 / a0,
];

// BiquadFilterNode coefficients as defined by the Web Audio API spec (Audio EQ Cookbook),
// including the edge cases browsers use at 0 Hz, at nyquist and for Q <= 0.
// BiquadFilterNode.getFrequencyResponse() isn't used: it reads the params' computed values, which
// change only when the audio thread renders, so the chart would lag (or freeze while the context
// is suspended, e.g. before the first user gesture) after setValueAtTime
const biquadCoefficients = (
  type: BiquadFilterType,
  { cutoff, resonance: Q, gain }: FilterProps,
  sampleRate: number
): Coefficients => {
  const f = cutoff / (sampleRate / 2);
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

const magnitudeDb = ([b0, b1, b2, a1, a2]: Coefficients, { cos1, sin1, cos2, sin2 }: Point) => {
  // H(z) at z = e^{jw}: (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
  const numRe = b0 + b1 * cos1 + b2 * cos2;
  const numIm = -(b1 * sin1 + b2 * sin2);
  const denRe = 1 + a1 * cos1 + a2 * cos2;
  const denIm = -(a1 * sin1 + a2 * sin2);
  const magnitude = Math.sqrt((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
  return 20 * Math.log10(magnitude);
};

const clampDb = (db: number) => (Number.isNaN(db) ? -DB_RANGE : Math.min(DB_RANGE, Math.max(-DB_RANGE, db)));

export const frequencyResponseDb = (
  type: BiquadFilterType,
  props: FilterProps,
  freq: number,
  sampleRate: number
) => clampDb(magnitudeDb(biquadCoefficients(type, props, sampleRate), point(freq, sampleRate)));

export const getChartData = (type: BiquadFilterType, props: FilterProps, sampleRate: number): ChartArray => {
  const coefficients = biquadCoefficients(type, props, sampleRate);
  const grid = getGrid(sampleRate);
  // the exact cutoff point keeps narrow peaks and notches visible
  const points = [...grid];
  if (props.cutoff > MIN_FREQ && props.cutoff < grid[grid.length - 1].freq) {
    points.splice(
      grid.findIndex(({ freq }) => freq > props.cutoff),
      0,
      point(props.cutoff, sampleRate)
    );
  }
  return points.map((p) => [p.freq, clampDb(magnitudeDb(coefficients, p))]);
};
