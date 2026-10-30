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
// lands on it). A note reads the level of its pitch alone, its top harmonic from nyquist · 2^(-1/3) up to the
// nyquist, but over the top fifth of the third of an octave (a crossfade into the next one; a native oscillator
// crossfades over all of it: its top a third of an octave lower in the middle)
export const levelBase = (harmonics: number) => 2 ** Math.ceil(Math.log2(harmonics + 1));

export const LEVELS_PER_OCTAVE = 3;
// samples of a level: 32 per cycle of its highest harmonic, a power of two in 512..4096 (the oscillator reads
// them linearly; a held note in a crossfade reads a mix of two as long as the first)
const SAMPLES_PER_HARMONIC = 32;
const MIN_LENGTH = 512;
const MAX_LENGTH = 4096;

const nextPowerOfTwo = (value: number) => 2 ** Math.ceil(Math.log2(Math.max(1, value)));

// the harmonics of each level of a table whose frames have up to `harmonics`, the silent level last
export const levelHarmonics = (harmonics: number) => {
  const base = levelBase(harmonics);
  const levels: number[] = [];
  for (let r = 0; ; r++) {
    // 1e-9: 2^(-3/3) of 1024 is 512, not 511.99…
    const count = Math.floor(base * 2 ** (-r / LEVELS_PER_OCTAVE) + 1e-9);
    if (count < 1) break;
    levels.push(Math.min(harmonics, count));
  }
  return [...levels, 0];
};

// (the silent level is one sample of 0: it is read, never played)
export const levelLength = (harmonics: number) =>
  harmonics === 0
    ? 1
    : Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, nextPowerOfTwo(SAMPLES_PER_HARMONIC * harmonics)));

// the layout of a table of `frames` frames with up to `harmonics` harmonics, data not filled
export const createLevels = (frames: number, harmonics: number, buffer?: ArrayBuffer): WavetableLevels => {
  const counts = levelHarmonics(harmonics);
  const lengths = Int32Array.from(counts, levelLength);
  const offsets = new Int32Array(counts.length);
  let size = 0;
  lengths.forEach((length, r) => {
    offsets[r] = size;
    size += frames * (length + FRAME_GUARD);
  });
  const data =
    buffer && buffer.byteLength === size * Float32Array.BYTES_PER_ELEMENT
      ? new Float32Array(buffer)
      : new Float32Array(size);
  return { frames, harmonics: Int32Array.from(counts), lengths, offsets, data };
};
