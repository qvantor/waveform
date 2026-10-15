import { mean } from 'lodash';
import { biquad } from '@waveform/math';
import { LINE_TIMES, lineDecay, lineFactor, loopLength, XOVER } from '../../effects/reverb-decay';

export interface DecayParams {
  size: number;
  decay: number;
  damp: number;
  bass: number;
}

export const DECAY_CHART_FREQS = Array.from({ length: 64 }, (_, i) => 20 * 1000 ** (i / 63));

// RT60 (s) over frequency, for the decay chart: a line of the average loop length through the
// same shelves as the feedback lines (their magnitudes at the frequency are added to the per pass loss)
export const decayCurve = (
  { size, decay, damp, bass }: DecayParams,
  sampleRate: number
): [number, number][] => {
  const factor = lineFactor(size, decay);
  const length = mean(LINE_TIMES.map((_, i) => loopLength(i, factor)));
  const { gain, lowDb, highDb } = lineDecay(length, decay, bass);
  const passDb = 20 * Math.log10(gain);
  const low = biquad.coefficients('lowshelf', { frequency: XOVER, Q: 0, gain: lowDb }, sampleRate);
  const high = biquad.coefficients('highshelf', { frequency: damp, Q: 0, gain: highDb }, sampleRate);
  return DECAY_CHART_FREQS.map((freq) => {
    const db =
      passDb + biquad.magnitudeDb(low, freq, sampleRate) + biquad.magnitudeDb(high, freq, sampleRate);
    return [freq, (-60 * length) / Math.min(db, -1e-6)];
  });
};
