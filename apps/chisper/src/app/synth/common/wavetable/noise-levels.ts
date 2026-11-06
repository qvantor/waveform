import { fir } from '@chisper/math';
import { NOISE_OVERSAMPLE, NOISE_SEAM, noiseLevels } from './noise-layout';
import type { WavetableLevels } from './wavetable-levels';

// the levels of a sample of the noise (dsp/wavetable-osc/src/noise.rs reads them; built once in the worker): level 0
// the sample, level l ≥ 1 it decimated by 2^l (frame f at frame f · 2^l of the sample: a lowpass of zero phase),
// twice: filtered with zeros past its ends (a one-shot reads them) and around its loop (a loop reads them: the
// frames past its ends the loop going on on its grid, its seam seamless at every level); then the pair a step up to
// 1 reads, level 0 upsampled by NOISE_OVERSAMPLE (frame g at frame g / 2 of the sample), its one-shot and its loop.
// As WavetableLevels: its channels as `frames`, `rate` its sample rate, the lengths and offsets of level 0, the
// one-shot levels 1..L, the loop levels 1..L and the pair (harmonics: NOISE_OVERSAMPLE at the pair, 0 elsewhere);
// each level its channels interleaved between NOISE_GUARD frames of 0 (the window of a one-shot reads past its
// ends), the ring of the interpolator before the start of the one-shot of the pair in the guard before it, the
// NOISE_SEAM frames of a loop level next to it the loop going on

// the decimator from a level to the next: 2·HALF - 1 taps, its transition 0.42..0.5 of the nyquist of the level it
// reads (the stopband, from -80 dB, at the nyquist of the next level: nothing aliases into it; it keeps 0.84 of
// it)
const HALF = 64;
const BETA = 7.86;
const CUTOFF = 0.46;
// the levels stop past these (a step past the last, 2^13: silent; the knobs reach 10.7 octaves, Pitch +49
// semitones, Pitch Track at MIDI 127 and a bend of 2 octaves: level 12 at a context of 11 kHz), or before one
// shorter than MIN_FRAMES
const MAX_LEVELS = 12;
const MIN_FRAMES = 4;

// the kernels here are symmetric (a sinc of zero phase): folded, a tap weighs a frame and its mirror added, one
// multiply for both. An odd one is its centre tap and the c taps before it, an even one its first half
interface OddKernel {
  centre: number;
  half: Float64Array;
}
const foldOdd = (taps: Float64Array): OddKernel => {
  const c = (taps.length - 1) / 2;
  return { centre: taps[c], half: taps.slice(0, c) };
};

// a kernel at frame i of x (over x[i..i + 2c] or x[i..i + 2h - 1]): the mirrored frames added, every other pair in
// a sum of its own (two chains of additions at once), the two sums added last. Against the taps one by one in a
// single sum it differs in the last bits of the f64, which the f32 of a level rounds away all but always
const oddAt = ({ centre, half }: OddKernel, x: Float32Array, i: number) => {
  const c = half.length;
  const last = i + 2 * c;
  let a = centre * x[i + c];
  let b = 0;
  let j = 0;
  for (; j + 1 < c; j += 2) {
    a += half[j] * (x[i + j] + x[last - j]);
    b += half[j + 1] * (x[i + j + 1] + x[last - j - 1]);
  }
  if (j < c) a += half[j] * (x[i + j] + x[last - j]);
  return a + b;
};
const evenAt = (half: Float64Array, x: Float32Array, i: number) => {
  const h = half.length;
  const last = i + 2 * h - 1;
  let a = 0;
  let b = 0;
  let j = 0;
  for (; j + 1 < h; j += 2) {
    a += half[j] * (x[i + j] + x[last - j]);
    b += half[j + 1] * (x[i + j + 1] + x[last - j - 1]);
  }
  if (j < h) a += half[j] * (x[i + j] + x[last - j]);
  return a + b;
};

const DECIMATOR_TAPS = 2 * HALF - 1;
const DECIMATOR = (() => {
  const taps = Float64Array.from({ length: DECIMATOR_TAPS }, (_, j) =>
    fir.kaiserSinc(j - HALF + 1, HALF, BETA, CUTOFF)
  );
  const sum = taps.reduce((a, b) => a + b, 0);
  return foldOdd(taps.map((tap) => tap / sum));
})();

// a channel decimated by 2: frame f of it is the filter centred on frame 2f, 0 past the ends (a frame whose taps
// reach past them reads a window of its frames and zeros: the same sums as within it)
const decimate = (x: Float32Array) => {
  const n = x.length;
  const y = new Float32Array(Math.ceil(n / 2));
  const window = new Float32Array(DECIMATOR_TAPS);
  for (let f = 0; f < y.length; f++) {
    const first = 2 * f - HALF + 1;
    if (first >= 0 && first + DECIMATOR_TAPS <= n) {
      y[f] = oddAt(DECIMATOR, x, first);
    } else {
      for (let j = 0; j < DECIMATOR_TAPS; j++) {
        const i = first + j;
        window[j] = i >= 0 && i < n ? x[i] : 0;
      }
      y[f] = oddAt(DECIMATOR, window, 0);
    }
  }
  return y;
};

// frames of a level of a loop: from frame `from` on, or (`period` > 0) the frames of one period from frame 0, the
// others around it
interface LoopFrames {
  from: number;
  period: number;
  values: Float32Array;
}

// the loop levels 1..L of a channel (`lengths` their frames, those of the one-shot levels), each with NOISE_SEAM
// frames before and after it: level l at frame k, for every k, is the decimators one after another at frame k · 2^l
// of the loop around it, the sums of decimate (a window around the seam of a period gathered). Its frames go around
// the loop by n / gcd(n, 2^l): a loop whose length 2^l doesn't divide (an odd one: at every level) doesn't wrap at
// its ceil(n / 2^l) frames, the frame after its last is at frame n + 2^l - (n mod 2^l) of the sample (around them:
// at frame n, a click); its frames past its ends are the loop going on there. Each level is worked out over the
// frames the levels above it read (from the top down: twice theirs and the half of the decimator around them), or
// over its period where that is shorter, the frames past it around it (the top levels reach around the loop many
// times: their frames below are those of a whole period)
const loopLevels = (x: Float32Array, lengths: number[]) => {
  const count = lengths.length;
  const window = new Float32Array(DECIMATOR_TAPS);
  // the frames level l needs: its own, its seams, and those level l + 1 reads (l = 1..count, at l - 1)
  const lo = new Array<number>(count);
  const hi = new Array<number>(count);
  for (let l = count; l >= 1; l--) {
    lo[l - 1] = -NOISE_SEAM;
    hi[l - 1] = lengths[l - 1] + NOISE_SEAM;
    if (l < count) {
      lo[l - 1] = Math.min(lo[l - 1], 2 * lo[l] - HALF + 1);
      hi[l - 1] = Math.max(hi[l - 1], 2 * hi[l] + HALF - 2);
    }
  }
  let below: LoopFrames = { from: 0, period: x.length, values: x };
  // the frames of a period of the level (of level 0: the loop)
  let period = x.length;
  return lengths.map((frames, l) => {
    period = period % 2 === 0 ? period / 2 : period;
    const whole = hi[l] - lo[l] >= period;
    const from = whole ? 0 : lo[l];
    const values = new Float32Array(whole ? period : hi[l] - lo[l]);
    const { from: at, period: around, values: source } = below;
    for (let f = 0; f < values.length; f++) {
      const first = 2 * (from + f) - HALF + 1;
      if (around === 0) {
        values[f] = oddAt(DECIMATOR, source, first - at);
      } else {
        let i = ((first % around) + around) % around;
        if (i + DECIMATOR_TAPS <= around) {
          values[f] = oddAt(DECIMATOR, source, i);
        } else {
          for (let j = 0; j < DECIMATOR_TAPS; j++) {
            window[j] = source[i];
            if (++i === around) i = 0;
          }
          values[f] = oddAt(DECIMATOR, window, 0);
        }
      }
    }
    below = { from, period: whole ? period : 0, values };
    return Float32Array.from({ length: frames + 2 * NOISE_SEAM }, (_, g) => {
      const k = g - NOISE_SEAM;
      return whole ? values[((k % period) + period) % period] : values[k - from];
    });
  });
};

// the interpolator of the pair (2×): phase p weighs frame f + k of the sample (k = 1 - UP_HALF .. UP_HALF) at the
// point f + p/2, its taps summing to 1 (DC passes exactly); flat to 0.9 of the nyquist of the sample within 0.0001
// dB, its stopband from the nyquist at -100 dB: nothing of the sample images into the pair, whose content stays within
// half of its nyquist (the short kernel noise.rs reads it through, 12 taps, takes the rest of its band as its
// transition)
const UP_HALF = 64;
const UP_BETA = 10;
const UP_CUTOFF = 0.95;
const UP_TAPS = 2 * UP_HALF;
const upsamplerPhase = (p: number) => {
  const taps = Float64Array.from({ length: UP_TAPS }, (_, j) =>
    fir.kaiserSinc(j - UP_HALF + 1 - p / 2, UP_HALF, UP_BETA, UP_CUTOFF)
  );
  const sum = taps.reduce((a, b) => a + b, 0);
  return taps.map((tap) => tap / sum);
};
// phase 0: its taps 0..UP_TAPS - 2 around the frame itself (the last, UP_HALF frames after it, is 0: the edge of
// the window), phase 1: UP_TAPS around the point between two frames
const UPSAMPLER_0 = foldOdd(upsamplerPhase(0).subarray(0, UP_TAPS - 1));
const UPSAMPLER_1 = upsamplerPhase(1).slice(0, UP_HALF);
// the frames of the one-shot of the pair past the end of the sample (where the interpolator rings) and before its
// start (in the guard: the window of a read at the start reaches 5 of them)
const OVER_TAIL = 2 * UP_HALF;
const OVER_LEAD = 6;

// the point f + p/2 of a channel: around its loop, or with zeros past its ends (a window that reaches past them
// gathered into `window`: the same sums as within it)
const pointOf = (x: Float32Array, f: number, p: number, looped: boolean, window: Float32Array) => {
  const n = x.length;
  const taps = p === 0 ? UP_TAPS - 1 : UP_TAPS;
  const first = f - UP_HALF + 1;
  let source = x;
  let at = first;
  if (first < 0 || first + taps > n) {
    for (let j = 0; j < taps; j++) {
      const i = first + j;
      window[j] = i >= 0 && i < n ? x[i] : looped ? x[((i % n) + n) % n] : 0;
    }
    source = window;
    at = 0;
  }
  return p === 0 ? oddAt(UPSAMPLER_0, source, at) : evenAt(UPSAMPLER_1, source, at);
};

// a channel upsampled by 2: its loop (2n frames, around the seam) and its one-shot (OVER_LEAD frames before its
// start, then 2n + OVER_TAIL frames, zeros past its ends); away from the ends both are the same points, computed once
const upsample = (x: Float32Array) => {
  const n = x.length;
  const window = new Float32Array(UP_TAPS);
  const loop = new Float32Array(NOISE_OVERSAMPLE * n);
  for (let g = 0; g < loop.length; g++) loop[g] = pointOf(x, g >> 1, g & 1, true, window);
  const once = new Float32Array(OVER_LEAD + NOISE_OVERSAMPLE * n + OVER_TAIL);
  for (let k = 0; k < once.length; k++) {
    const g = k - OVER_LEAD;
    const f = Math.floor(g / 2);
    const inside = g >= 0 && g < loop.length && f - UP_HALF + 1 >= 0 && f + UP_HALF + 1 <= n;
    once[k] = inside ? loop[g] : pointOf(x, f, g - 2 * f, false, window);
  }
  return { loop, once };
};

// the same samples (a stereo file of a mono sound): one channel, read once
const sameChannels = ([left, right]: Float32Array[]) =>
  left.length === right.length && left.every((value, i) => value === right[i]);

// the levels of a sample at `rate` (one or two channels: more are left out; a value that isn't finite is 0)
export const buildNoiseLevels = (sample: Float32Array[], rate: number): WavetableLevels => {
  const finite = sample
    .slice(0, 2)
    .map((channel) => channel.map((value) => (Number.isFinite(value) ? value : 0)));
  const channels = finite.length === 2 && sameChannels(finite) ? [finite[0]] : finite;
  const oneShot: Float32Array[][] = [];
  let once = channels;
  for (let level = 1; level <= MAX_LEVELS && Math.ceil(once[0].length / 2) >= MIN_FRAMES; level++) {
    once = once.map(decimate);
    oneShot.push(once);
  }
  // (as many as the one-shot levels, as long)
  const lengths = oneShot.map((level) => level[0].length);
  const loops = channels.map((channel) => loopLevels(channel, lengths));
  const loop = lengths.map((_, l) => loops.map((levels) => levels[l]));
  const pair = channels.map(upsample);
  // each level its channels and the frames of them in the guards before its frame 0 and after its last
  const levels = [
    ...[channels, ...oneShot].map((level) => ({ level, lead: 0, trail: 0 })),
    ...loop.map((level) => ({ level, lead: NOISE_SEAM, trail: NOISE_SEAM })),
    { level: pair.map(({ once }) => once), lead: OVER_LEAD, trail: 0 },
    { level: pair.map(({ loop }) => loop), lead: 0, trail: 0 },
  ];
  const width = channels.length;
  return noiseLevels(
    levels.map(({ level, lead, trail }) => level[0].length - lead - trail),
    width,
    rate,
    (data, at, k) => {
      const { level, lead } = levels[k];
      level.forEach((channel, c) => {
        for (let f = 0; f < channel.length; f++) data[at + (f - lead) * width + c] = channel[f];
      });
    },
    true
  );
};
