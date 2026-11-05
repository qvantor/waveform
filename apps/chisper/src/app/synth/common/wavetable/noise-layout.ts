import type { WavetableLevels } from './wavetable-levels';

// the layout of the levels of a sample of the noise (noise-levels.ts builds them, noise.rs reads them); no imports:
// the worklet bundles it without the filters of the worker

// GUARD of noise.rs: the frames of 0 around each level, twice the half of its longest kernel
export const NOISE_GUARD = 96;

// the levels of `channels` (one or two) as WavetableLevels: level 0, the one-shot levels 1..L, then the loop
// levels 1..L, each interleaved between NOISE_GUARD frames of 0; their data filled by `fill` (level k, channel c,
// frame f), 0 without it
export const noiseLevels = (
  lengths: number[],
  width: number,
  rate: number,
  fill?: (data: Float32Array, at: number, k: number) => void
): WavetableLevels => {
  const offsets = new Int32Array(lengths.length);
  let size = 0;
  lengths.forEach((length, k) => {
    offsets[k] = size + NOISE_GUARD * width;
    size += (length + 2 * NOISE_GUARD) * width;
  });
  const data = new Float32Array(size);
  if (fill) lengths.forEach((_, k) => fill(data, offsets[k], k));
  return {
    frames: width,
    harmonics: new Int32Array(lengths.length),
    lengths: Int32Array.from(lengths),
    offsets,
    data,
    rate,
  };
};
