import { wave } from '@waveform/math';
import { createLevels, FRAME_GUARD, levelHarmonics, levelLength, WavetableLevels } from './wavetable-levels';

// the band-limited levels of a wavetable the oscillator worklet plays (wavetable-osc-dsp.ts), built from its
// frames in a Web Worker (wavetable.worker.ts). Like the PeriodicWave of a browser, a frame is kept at levels
// a third of an octave apart: level r has the harmonics up to harmonics · 2^(-r/3) (harmonics: those of the
// frame, 1023 for 2048 samples), a note plays the levels that don't fold back above the nyquist at its
// pitch (levelBase: on the grid of a native PeriodicWave). DC and the nyquist bin of a frame are dropped (wave.realWithImag), the phases of its harmonics kept

// a table holds at most this many frames (the tables of the bucket have 256 at most)
export const MAX_FRAMES = 256;
// the harmonics of a frame of 2048 samples, the longest one
export const MAX_HARMONICS = 1023;
// the harmonics of a frame: those below its nyquist, at most MAX_HARMONICS
export const frameHarmonics = (frame: ArrayLike<number>) =>
  Math.min(MAX_HARMONICS, Math.max(0, Math.ceil(frame.length / 2) - 1));

// writes the levels of frame `index` (a frame with fewer harmonics than the table gets silent ones above
// its own); the other frames keep theirs, so one edited frame is rebuilt on its own
export const writeFrame = (levels: WavetableLevels, index: number, frame: ArrayLike<number>) => {
  const { harmonics, lengths, offsets, data } = levels;
  const [real, imag] = wave.realWithImag(frame);
  const own = frameHarmonics(frame);
  // at the volume of the frame (createPeriodicWave normalizes each wave by its peak)
  for (let r = 0; r < lengths.length; r++) {
    const length = lengths[r];
    const start = offsets[r] + index * (length + FRAME_GUARD);
    if (harmonics[r] === 0) {
      data.fill(0, start, start + length + FRAME_GUARD);
      continue;
    }
    const samples = data.subarray(start + 1, start + 1 + length);
    wave.fromRealWithImag(real, imag, Math.min(own, harmonics[r]), length, samples);
    data[start] = samples[length - 1];
    data[start + 1 + length] = samples[0];
    data[start + 2 + length] = samples[1];
  }
};

const tableLayout = (frames: ArrayLike<number>[]) => {
  const used = frames.slice(0, MAX_FRAMES);
  return { used, harmonics: used.reduce((max, frame) => Math.max(max, frameHarmonics(frame)), 0) };
};

// bytes of the data of a table: a freed buffer of this size is reused for it
export const tableBytes = (frames: ArrayLike<number>[]) => {
  const { used, harmonics } = tableLayout(frames);
  const levels = levelHarmonics(harmonics).map(levelLength);
  return Math.max(1, used.length) * levels.reduce((sum, length) => sum + length + FRAME_GUARD, 0) * 4;
};

// the levels of a table, its frames 1..MAX_FRAMES (more are dropped) of up to MAX_HARMONICS each; a buffer of
// the size the table needs is reused (one freed by the store of the worklet)
export const buildLevels = (frames: ArrayLike<number>[], buffer?: ArrayBuffer) => {
  const { used, harmonics } = tableLayout(frames);
  const levels = createLevels(Math.max(1, used.length), harmonics, buffer);
  // a reused buffer holds the previous table
  if (!used.length) levels.data.fill(0);
  used.forEach((frame, index) => writeFrame(levels, index, frame));
  return levels;
};
