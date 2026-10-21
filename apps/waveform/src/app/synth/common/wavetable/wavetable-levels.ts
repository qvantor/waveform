// the layout of the band-limited levels of a wavetable (built by wavetable-mipmap.ts, played by
// wavetable-osc-dsp.ts); no imports: the worklet bundles it without the FFT

// frame f of level r: lengths[r] + FRAME_GUARD samples from offsets[r] + f · (lengths[r] + FRAME_GUARD), sample
// j at offset 1 + j: the last sample of the cycle comes first, the first two after it again (the
// interpolation reads around a sample without a wrap). The last level is silent (0
// harmonics): a pitch above the fundamental's nyquist fades into it. A level is the same frame with fewer
// harmonics, at the volume of the frame (not normalized)
export interface WavetableLevels {
  frames: number;
  // per level: the harmonics it keeps (1..harmonics[r]), its length (a power of two) and the start of frame 0
  harmonics: Int32Array;
  lengths: Int32Array;
  offsets: Int32Array;
  data: Float32Array;
}

// the samples around a cycle: 1 before, 2 after
export const FRAME_GUARD = 3;

// the start of frame `index` of `level` in levels.data (its sample 0 is the next one)
export const frameStart = (
  levels: Pick<WavetableLevels, 'lengths' | 'offsets'>,
  level: number,
  index: number
) => levels.offsets[level] + index * (levels.lengths[level] + FRAME_GUARD);

// the levels of a table are a third of an octave apart on the grid of a browser's PeriodicWave: level r keeps
// the harmonics up to base · 2^(-r/3), at most those of the table; base is the power of two above them (1024
// for 1023 harmonics, a frame of 2048 samples), the grid of Chrome and WebKit (their table size / 2 · 2^(-r/3)
// lands on it), so a note gets as many harmonics as from a native oscillator
export const levelBase = (harmonics: number) => 2 ** Math.ceil(Math.log2(harmonics + 1));
