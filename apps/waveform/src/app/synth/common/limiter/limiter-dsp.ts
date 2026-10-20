import { createTruePeak, TRUE_PEAK_DELAY } from './true-peak';

// the master limiter runs in an audio worklet (limiter.worklet.ts), this is its signal processing (and the
// reference of its Rust core, dsp/limiter: limiter.wasm.worklet.ts)

export { LIMITER_PROCESSOR } from '../processors';

// the true peak of the output never goes over it (dBTP)
export const CEILING_DB = -0.5;
export const CEILING = 10 ** (CEILING_DB / 20);
// the gain reaches its value before the peak does: the sound is delayed by it (s)
export const LOOKAHEAD = 0.002;
// the gain of a peak is held this long after it (s): longer than a cycle of the bass, so the gain doesn't
// move inside a wave (moving with the wave is distortion)
const HOLD = 0.02;
// a short peak lets go fast, the limiting that goes on for a while lets go slowly, so a dense part
// doesn't pump between its peaks: the time constants (s) of both envelopes, the slow one rises and falls
// with the same
const FAST_RELEASE = 0.05;
const SLOW = 0.5;
// once the sound has needed less than the slow envelope for this long (s), the loud part is over: the slow
// envelope lets go like the fast one, down to what the sound still needs. Longer than the gaps between the
// notes of a dense part (an eighth note at 120 bpm)
const RECENT = 0.25;
// an envelope this close to 0 dB is 0, the gain is exactly 1 again
const RELEASED_DB = 1e-4;

// the max of the last `length` values (a monotonic queue, amortized O(1) per value)
const createSlidingMax = (length: number) => {
  const size = 2 ** Math.ceil(Math.log2(length + 1));
  const mask = size - 1;
  const values = new Float64Array(size);
  const times = new Float64Array(size);
  let head = 0;
  let tail = 0;
  let time = 0;
  return (value: number) => {
    // the smaller values before it can't be the max any more
    while (tail !== head && values[(tail - 1) & mask] <= value) tail = (tail - 1) & mask;
    values[tail] = value;
    times[tail] = time;
    tail = (tail + 1) & mask;
    if (times[head] <= time - length) head = (head + 1) & mask;
    time++;
    return values[head];
  };
};

// the mean of the last `length` values, starting from 1 (no gain change); the running sum is summed up
// again once per pass, so it doesn't drift and a released gain is exactly 1
const createBoxcar = (length: number) => {
  const values = new Float64Array(length).fill(1);
  let sum = length;
  let index = 0;
  return (value: number) => {
    sum += value - values[index];
    values[index] = value;
    if (++index === length) {
      index = 0;
      sum = 0;
      for (let i = 0; i < length; i++) sum += values[i];
    }
    return sum / length;
  };
};

// a whole number of samples of delay: takes a value, returns the one taken `length` calls before
const createDelay = (length: number) => {
  const buffer = new Float64Array(length);
  let index = 0;
  return (value: number) => {
    const delayed = buffer[index];
    buffer[index] = value;
    if (++index === length) index = 0;
    return delayed;
  };
};

const finite = (value: number) => (Number.isFinite(value) ? value : 0);

// a stereo linked, true peak, lookahead brickwall limiter. Per frame:
// input (NaN and infinities are silence, they would stay in the sums forever) → the true peak of both
// channels → its max over the hold window (lookahead + HOLD) → the attenuation it needs (dB)
// → envelopes: fast (instant attack, FAST_RELEASE) and slow (SLOW up and down, FAST_RELEASE down to the
// most the last RECENT needed), the larger one → gain → 2 moving averages over the lookahead (an S-shaped
// attack, no click) → × the input delayed by the lookahead and the detector delay.
// The averages see only gains held for the peak at the frame they land on, so the gain there is at most
// the one the peak needs: nothing goes over the ceiling. Below it, once released, the gain is exactly 1:
// the delayed input comes out bit for bit
export const createLimiterDsp = (sampleRate: number) => {
  const lookahead = Math.round(LOOKAHEAD * sampleRate);
  // the averages together span lookahead + 1 gains
  const average1 = Math.floor(lookahead / 2) + 1;
  const average2 = lookahead + 2 - average1;
  const latency = lookahead + TRUE_PEAK_DELAY;

  // the detectors skip the parts too quiet to reach the ceiling
  const peakL = createTruePeak(CEILING);
  const peakR = createTruePeak(CEILING);
  const held = createSlidingMax(lookahead + 1 + Math.round(HOLD * sampleRate));
  // the most attenuation (dB) the last RECENT needed
  const recent = createSlidingMax(Math.round(RECENT * sampleRate));
  const smooth1 = createBoxcar(average1);
  const smooth2 = createBoxcar(average2);
  const delayL = createDelay(latency);
  const delayR = createDelay(latency);
  const fastRelease = Math.exp(-1 / (FAST_RELEASE * sampleRate));
  const slowCoefficient = 1 - Math.exp(-1 / (SLOW * sampleRate));
  // attenuation (dB) of the envelopes
  let fast = 0;
  let slow = 0;
  // the held peak and the attenuation stay the same for many frames: their dB and gain are kept
  let lastPeak = 0;
  let lastOver = 0;
  let lastAttenuation = 0;
  let lastGain = 1;

  const process = (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array) => {
    for (let s = 0; s < outL.length; s++) {
      const l = finite(inL[s]);
      const r = finite(inR[s]);

      const peak = held(Math.max(peakL(l), peakR(r)));
      if (peak !== lastPeak) {
        lastPeak = peak;
        lastOver = peak > CEILING ? 20 * Math.log10(peak / CEILING) : 0;
      }
      const over = lastOver;
      const recentOver = recent(over);
      fast = Math.max(over, fast * fastRelease);
      slow =
        slow > recentOver ? Math.max(recentOver, slow * fastRelease) : slow + (over - slow) * slowCoefficient;
      if (fast < RELEASED_DB) fast = 0;
      if (slow < RELEASED_DB) slow = 0;
      const attenuation = Math.max(fast, slow);
      if (attenuation !== lastAttenuation) {
        lastAttenuation = attenuation;
        lastGain = attenuation > 0 ? 10 ** (-attenuation / 20) : 1;
      }
      const gain = Math.min(1, smooth2(smooth1(lastGain)));

      // the gain lands on its frame; the clamp only takes the rounding errors of the sums
      outL[s] = Math.max(-CEILING, Math.min(CEILING, delayL(l) * gain));
      outR[s] = Math.max(-CEILING, Math.min(CEILING, delayR(r) * gain));
    }
  };

  return { process, latency };
};
