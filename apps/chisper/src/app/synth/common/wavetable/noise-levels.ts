import { fir } from '@chisper/math';
import { noiseLevels } from './noise-layout';
import type { WavetableLevels } from './wavetable-levels';

// the levels of a sample of the noise (dsp/wavetable-osc/src/noise.rs reads them; built once in the worker): level 0
// the sample, level l ≥ 1 it decimated by 2^l (frame f at frame f · 2^l of the sample: a lowpass of zero phase),
// twice: filtered with zeros past its ends (a one-shot reads them) and around its loop (a loop reads them, its seam
// stays seamless at every level). As WavetableLevels: its channels as `frames`, `rate` its sample rate, the
// lengths and offsets of level 0, the one-shot levels 1..L, then the loop levels 1..L (harmonics: none); each
// level its channels interleaved between NOISE_GUARD frames of 0 (the window of a one-shot reads past its ends)

// the decimator from a level to the next: 2·HALF - 1 taps, its transition 0.42..0.5 of the nyquist of the level it
// reads (the stopband, from -80 dB, at the nyquist of the next level: nothing aliases into it; it keeps 0.84 of
// it)
const HALF = 64;
const BETA = 7.86;
const CUTOFF = 0.46;
// the levels stop past these (a step past the last: silent), or before one shorter than MIN_FRAMES
const MAX_LEVELS = 16;
const MIN_FRAMES = 4;

const DECIMATOR = (() => {
  const taps = Float64Array.from({ length: 2 * HALF - 1 }, (_, j) =>
    fir.kaiserSinc(j - HALF + 1, HALF, BETA, CUTOFF)
  );
  const sum = taps.reduce((a, b) => a + b, 0);
  return taps.map((tap) => tap / sum);
})();

// a channel decimated by 2: frame f of it is the filter centred on frame 2f; past the ends 0, or around the loop
const decimate = (x: Float32Array, looped: boolean) => {
  const n = x.length;
  const y = new Float32Array(Math.ceil(n / 2));
  for (let f = 0; f < y.length; f++) {
    let sum = 0;
    for (let j = 0; j < DECIMATOR.length; j++) {
      const tap = DECIMATOR[j];
      let i = 2 * f + j - HALF + 1;
      if (i < 0 || i >= n) {
        if (!looped) continue;
        i = ((i % n) + n) % n;
      }
      sum += tap * x[i];
    }
    y[f] = sum;
  }
  return y;
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
  const loop: Float32Array[][] = [];
  let [once, around] = [channels, channels];
  for (let level = 1; level <= MAX_LEVELS && Math.ceil(once[0].length / 2) >= MIN_FRAMES; level++) {
    once = once.map((channel) => decimate(channel, false));
    around = around.map((channel) => decimate(channel, true));
    oneShot.push(once);
    loop.push(around);
  }
  const levels = [channels, ...oneShot, ...loop];
  const width = channels.length;
  return noiseLevels(
    levels.map((level) => level[0].length),
    width,
    rate,
    (data, at, k) =>
      levels[k].forEach((channel, c) => {
        for (let f = 0; f < channel.length; f++) data[at + f * width + c] = channel[f];
      })
  );
};
