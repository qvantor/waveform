import { fir } from '@waveform/math';

// 4× oversampling around a waveshaper: a curve adds harmonics far above the nyquist, at the context rate
// they would fold back down as inharmonic tones. up() interpolates 4 points per sample, the curve shapes
// them, down() band-limits them back to the nyquist and keeps every 4th point. Both are polyphase windowed
// sincs (fir.sincPhase) of linear phase, so the delay is the same for every frequency.
// down() is the one of the true peak detector, cut at the nyquist (flat within 0.03 dB up to 0.45·fs): its
// transition band reaches over the nyquist, but what it lets fold back lands above 0.45·fs (20 kHz).
// up() is cut lower (UP_CUTOFF: flat up to 0.4·fs, -6 dB at 0.45·fs, the images from the nyquist up 54 dB
// down): cut at the nyquist it would pass half of the images of the partials just below it (an oscillator
// plays them up to the nyquist), and the curve mixes the images with every partial into inharmonic tones
// (soft clip of a saw at 12 dB drive: -65 dB instead of -96 dB). Its phase 0 is no longer the input itself

export const OVERSAMPLING = 4;
const TAPS = 32;
const KAISER_BETA = 5;
const HALF = TAPS / 2;
// the cut of up(), × the nyquist of the input
const UP_CUTOFF = 0.9;
// samples from x to down() of its points: HALF for the interpolation, HALF for the decimation
export const OVERSAMPLER_LATENCY = 2 * HALF;

// phase p (0..3) of up() reads the point p/4 of a sample after the center: tap j weighs the sample j steps
// back. The Rust core reads them and those of down() from dsp-core/src/consts.rs (dsp/gen/consts.mjs)
export const UP_PHASES = [0, 1, 2, 3].map((phase) =>
  fir.sincPhase(phase, OVERSAMPLING, TAPS, KAISER_BETA, UP_CUTOFF)
);
const [UP0, UP1, UP2, UP3] = UP_PHASES;
// the ones of down(), cut at the nyquist (its phase 0 is the center point alone)
export const DOWN_PHASES = [1, 2, 3].map((phase) => fir.sincPhase(phase, OVERSAMPLING, TAPS, KAISER_BETA));
const [PHASE1, PHASE2, PHASE3] = DOWN_PHASES;
// the decimator reads its 4 streams of points one step further back than up() reads the samples (the
// newest points are HALF + 1/4·q after the output point, their taps are 0)
const STREAM = TAPS + 1;

// a block at a time: the samples come in and go out in typed arrays, so the loops call nothing and no
// number is boxed on the way (V8 boxes the doubles a call returns unless it is inlined)
export const createOversampler = () => {
  // every value is written twice, so the last TAPS of them are always in one run: history[pos + j] is the
  // value written j steps ago
  const history = new Float64Array(2 * TAPS);
  let pos = 0;
  // the points of up() by phase, read by down()
  const [s0, s1, s2, s3] = Array.from({ length: OVERSAMPLING }, () => new Float64Array(2 * STREAM));
  let streamPos = 0;

  return {
    // 4 points per sample of input[0..frames) into points[0..4·frames): the ones from the sample written
    // HALF steps before it up to the next one
    up: (input: Float64Array, frames: number, points: Float64Array) => {
      for (let s = 0; s < frames; s++) {
        const x = input[s];
        pos = pos === 0 ? TAPS - 1 : pos - 1;
        history[pos] = x;
        history[pos + TAPS] = x;
        let y0 = 0;
        let y1 = 0;
        let y2 = 0;
        let y3 = 0;
        for (let j = 0; j < TAPS; j++) {
          const h = history[pos + j];
          y0 += h * UP0[j];
          y1 += h * UP1[j];
          y2 += h * UP2[j];
          y3 += h * UP3[j];
        }
        const point = OVERSAMPLING * s;
        points[point] = y0;
        points[point + 1] = y1;
        points[point + 2] = y2;
        points[point + 3] = y3;
      }
    },
    // the (shaped) points of up() back at the input rate into output[0..frames): each sample is the
    // band-limited one HALF steps before its 4 points. Point q of a step is 1/4·q after it: it is weighed
    // with phase 4 - q of the sinc cut at the nyquist, which reads as far before the point as this one lies
    // after it; phase 0 falls on the whole samples, where that sinc is 0 but at the center. Each stream sums
    // to 1, the 4 of them are averaged: DC passes exactly
    down: (points: Float64Array, frames: number, output: Float64Array) => {
      for (let s = 0; s < frames; s++) {
        const point = OVERSAMPLING * s;
        streamPos = streamPos === 0 ? STREAM - 1 : streamPos - 1;
        s0[streamPos] = s0[streamPos + STREAM] = points[point];
        s1[streamPos] = s1[streamPos + STREAM] = points[point + 1];
        s2[streamPos] = s2[streamPos + STREAM] = points[point + 2];
        s3[streamPos] = s3[streamPos + STREAM] = points[point + 3];
        let sum = s0[streamPos + HALF];
        for (let j = 0; j < TAPS; j++) {
          const i = streamPos + j + 1;
          sum += s1[i] * PHASE3[j] + s2[i] * PHASE2[j] + s3[i] * PHASE1[j];
        }
        output[s] = sum / OVERSAMPLING;
      }
    },
    clear: () => {
      history.fill(0);
      [s0, s1, s2, s3].forEach((stream) => stream.fill(0));
    },
  };
};
