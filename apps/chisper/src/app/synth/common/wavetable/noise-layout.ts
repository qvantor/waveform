import type { WavetableLevels } from './wavetable-levels';

// the layout of the levels of a sample of the noise (noise-levels.ts builds them, noise.rs reads them); no imports:
// the worklet bundles it without the filters of the worker

// GUARD of noise.rs: the frames of 0 around each level, twice the half of its longest kernel (before the one-shot
// level of the pair: the ring of its interpolator before the start of the sample)
export const NOISE_GUARD = 96;
// SEAM of noise.rs: the frames past the ends of a loop level past level 0 a window of the bank reads (the half of
// its longest kernel, 32 taps at cutoff 1/2), its guards hold the loop going on there
export const NOISE_SEAM = 16;
// OVERSAMPLE of noise.rs: the pair of levels a step up to 1 reads is level 0 upsampled by it, and their harmonics
// say so (0 at the other levels)
export const NOISE_OVERSAMPLE = 2;

// the levels of `channels` (one or two) as WavetableLevels: level 0, the one-shot levels 1..L, the loop levels 1..L,
// then (`oversampled`) the pair of level 0 upsampled by NOISE_OVERSAMPLE, its one-shot and its loop; each
// interleaved between NOISE_GUARD frames of 0 (`fill` may write into them: the ring before the one-shot of the pair,
// the loop going on next to a loop level); their data filled by `fill` (level k, channel c, frame f), 0 without it
export const noiseLevels = (
  lengths: number[],
  width: number,
  rate: number,
  fill?: (data: Float32Array, at: number, k: number) => void,
  oversampled = false
): WavetableLevels => {
  const offsets = new Int32Array(lengths.length);
  let size = 0;
  lengths.forEach((length, k) => {
    offsets[k] = size + NOISE_GUARD * width;
    size += (length + 2 * NOISE_GUARD) * width;
  });
  const data = new Float32Array(size);
  if (fill) lengths.forEach((_, k) => fill(data, offsets[k], k));
  const harmonics = new Int32Array(lengths.length);
  if (oversampled) harmonics.fill(NOISE_OVERSAMPLE, lengths.length - 2);
  return {
    frames: width,
    harmonics,
    lengths: Int32Array.from(lengths),
    offsets,
    data,
    rate,
  };
};
