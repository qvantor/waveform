// the frames of a table as an Audio Unit plays them (measured with tables of our own:
// dsp/measurements/frames.json), no imports: the worker, the main thread and the specs share it.
// - A position plays one frame, never a mix of two: the share v of the table plays frame ceil(v·M) - 1 of its
//   M frames (v·M in (k, k + 1] is frame k), within the table.
// - A table with a morph mark (the clm chunk of its file, `<!>2048 X…`: X not 0) of fewer than 256 frames
//   plays expanded to MORPHED_FRAMES by crossfades at load: its frame j at keyFrame(j), between two of them the
//   next one weighs (i + 1) / (s + 1) at i frames into a span of s (the share 1 / (s + 1) is
//   never played), whatever the mark (a spectral one too).

export const MORPHED_FRAMES = 256;

// the frames a table plays: expanded with a morph mark
export const playedFrames = (count: number, morph: boolean) =>
  morph && count > 1 && count < MORPHED_FRAMES ? MORPHED_FRAMES : count;

// the frame a share of the table plays among `count`
export const playedFrame = (share: number, count: number) =>
  Math.min(count - 1, Math.max(0, Math.ceil(share * count) - 1));

// the expanded frame source frame j of `count` lands on
export const keyFrame = (j: number, count: number) => Math.round((j * (MORPHED_FRAMES - 1)) / (count - 1));

// expanded frame e of a table of `count` frames: the source frame below it and the share of the next one
export const morphedFrame = (e: number, count: number) => {
  let j = Math.min(count - 2, Math.floor((e * (count - 1)) / (MORPHED_FRAMES - 1)));
  while (j > 0 && keyFrame(j, count) > e) j--;
  while (j < count - 2 && keyFrame(j + 1, count) <= e) j++;
  const from = keyFrame(j, count);
  const span = keyFrame(j + 1, count) - from;
  const i = e - from;
  return { frame: j, share: i === 0 ? 0 : i === span ? 1 : (i + 1) / (span + 1) };
};

// the frame of a crossfade: a·(1 - share) + b·share (of the shorter frame between frames of different lengths)
export const crossfadeFrames = <T extends Float32Array | Float64Array = Float32Array>(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  share: number,
  out: T = new Float32Array(Math.min(a.length, b.length)) as T
): T => {
  for (let i = 0; i < out.length; i++) out[i] = a[i] * (1 - share) + b[i] * share;
  return out;
};

// the MORPHED_FRAMES frames of a table with a morph mark
export const expandFrames = (frames: ArrayLike<number>[]): Float32Array[] =>
  Array.from({ length: MORPHED_FRAMES }, (_, e) => {
    const { frame, share } = morphedFrame(e, frames.length);
    return share === 0
      ? Float32Array.from(frames[frame])
      : crossfadeFrames(frames[frame], frames[frame + 1], share);
  });
