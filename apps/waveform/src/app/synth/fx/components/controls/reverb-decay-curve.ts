import { biquad } from '@waveform/math';
import { lineDecay, lineFactor, meanLoopLength, XOVER } from '../../effects/reverb-decay';

export interface DecayParams {
  size: number;
  decay: number;
  damp: number;
  bass: number;
}

export const DECAY_CHART_FREQS = Array.from({ length: 64 }, (_, i) => 20 * 1000 ** (i / 63));

const POINTS = DECAY_CHART_FREQS.length;

// the terms of z = e^{jw} at each frequency of the chart (cos w, sin w, cos 2w, sin 2w), by sample rate: the curve
// is drawn every frame while its knobs are modulated, without a trig function
const terms = new Map<number, Float64Array>();
const termsOf = (sampleRate: number) => {
  const cached = terms.get(sampleRate);
  if (cached) return cached;
  const t = new Float64Array(POINTS * 4);
  for (let i = 0; i < POINTS; i++) {
    const w = (2 * Math.PI * DECAY_CHART_FREQS[i]) / sampleRate;
    t[i * 4] = Math.cos(w);
    t[i * 4 + 1] = Math.sin(w);
    t[i * 4 + 2] = Math.cos(2 * w);
    t[i * 4 + 3] = Math.sin(2 * w);
  }
  terms.set(sampleRate, t);
  return t;
};

const magnitudeDb = (c: biquad.Coefficients, t: Float64Array, i: number) =>
  biquad.magnitudeDbAt(c, t[i * 4], t[i * 4 + 1], t[i * 4 + 2], t[i * 4 + 3]);

// RT60 (s) at each frequency of the chart (DECAY_CHART_FREQS) into `out`: a line of the average loop length through
// the same shelves as the feedback lines (their magnitudes at the frequency are added to the per pass loss)
export const decayCurve = (
  { size, decay, damp, bass }: DecayParams,
  sampleRate: number,
  out = new Float64Array(POINTS)
) => {
  const length = meanLoopLength(lineFactor(size, decay));
  const { gain, lowDb, highDb } = lineDecay(length, decay, bass);
  const passDb = 20 * Math.log10(gain);
  const low = biquad.coefficients('lowshelf', { frequency: XOVER, Q: 0, gain: lowDb }, sampleRate);
  const high = biquad.coefficients('highshelf', { frequency: damp, Q: 0, gain: highDb }, sampleRate);
  const t = termsOf(sampleRate);
  for (let i = 0; i < POINTS; i++) {
    const db = passDb + magnitudeDb(low, t, i) + magnitudeDb(high, t, i);
    out[i] = (-60 * length) / Math.min(db, -1e-6);
  }
  return out;
};
