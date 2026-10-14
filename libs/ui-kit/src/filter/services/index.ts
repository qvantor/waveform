import { biquad } from '@waveform/math';
import { FilterProps } from '../types';

type ChartArray = [number, number][];

type Coefficients = biquad.Coefficients;

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

// the chart reads the coefficients instead of BiquadFilterNode.getFrequencyResponse(): that reads the
// params' computed values, which change only when the audio thread renders, so the chart would lag (or
// freeze while the context is suspended, e.g. before the first user gesture) after setValueAtTime
const biquadCoefficients = (
  type: BiquadFilterType,
  { cutoff, resonance, gain }: FilterProps,
  sampleRate: number
): Coefficients => biquad.coefficients(type, { frequency: cutoff, Q: resonance, gain }, sampleRate);

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
