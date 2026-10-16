import { fir } from '@waveform/math';

// true peak detection (ITU-R BS.1770): a DAC reconstructs the wave between the samples, and there it can
// go over full scale although no sample does. The input is oversampled 4× by a polyphase windowed sinc
// cut exactly at the nyquist of the input, so its phase 0 is the input itself: the true peak is never
// below the sample peak

export const OVERSAMPLING = 4;
// taps per phase: up to 0.45·fs (20 kHz at 44.1 kHz) the phases are flat within 0.03 dB
export const TRUE_PEAK_TAPS = 32;
const KAISER_BETA = 5;
// the detector is centered DELAY samples back: next(x) is the peak from the sample written DELAY steps
// before x up to the next one
export const TRUE_PEAK_DELAY = TRUE_PEAK_TAPS / 2;

// phase p interpolates the point p/4 of a sample after the center (the sample written DELAY steps ago);
// every phase sums to 1, so DC reads exactly. Phase 0 is the center sample itself
const PHASES = Array.from({ length: OVERSAMPLING - 1 }, (_, i) =>
  fir.sincPhase(i + 1, OVERSAMPLING, TRUE_PEAK_TAPS, KAISER_BETA)
);
const [PHASE1, PHASE2, PHASE3] = PHASES;

// a point between the samples is a weighted sum of the last TAPS of them: it is at most this many times
// the loudest of them (+8.1 dB, the sum of the absolute taps of the half sample phase)
export const TRUE_PEAK_BOUND = Math.max(
  ...PHASES.map((taps) => taps.reduce((sum, tap) => sum + Math.abs(tap), 0))
);

// threshold: only the peaks from it up are needed (a limiter only cares about the ones over its ceiling).
// While the last TAPS samples are all below threshold / TRUE_PEAK_BOUND, no point between them can reach
// it: the interpolation is skipped and the reading is the center sample, below the threshold as well
export const createTruePeak = (threshold = 0) => {
  const quiet = threshold / TRUE_PEAK_BOUND;
  // every sample is written twice, so the last TAPS of them are always in one run: history[pos + j] is
  // the sample written j steps ago
  const history = new Float64Array(2 * TRUE_PEAK_TAPS);
  let pos = 0;
  // readings left with a sample from `quiet` up in the window
  let loud = 0;
  return (x: number) => {
    pos = pos === 0 ? TRUE_PEAK_TAPS - 1 : pos - 1;
    history[pos] = x;
    history[pos + TRUE_PEAK_TAPS] = x;
    const peak = Math.abs(history[pos + TRUE_PEAK_DELAY]);
    if (x >= quiet || -x >= quiet) loud = TRUE_PEAK_TAPS;
    else if (loud > 0) loud--;
    if (loud === 0) return peak;
    // the 3 phases in one pass over the history, each summed in the same order as alone
    let y1 = 0;
    let y2 = 0;
    let y3 = 0;
    for (let j = 0; j < TRUE_PEAK_TAPS; j++) {
      const h = history[pos + j];
      y1 += h * PHASE1[j];
      y2 += h * PHASE2[j];
      y3 += h * PHASE3[j];
    }
    return Math.max(peak, Math.abs(y1), Math.abs(y2), Math.abs(y3));
  };
};
