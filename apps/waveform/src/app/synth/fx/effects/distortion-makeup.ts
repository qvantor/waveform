import { number } from '@waveform/math';
import { DISTORTION_MODES, modeIndex } from './distortion-modes';

// the drive pushes the sound into the ceiling of the curve: the peaks stop growing there, but the waves get
// denser (towards a square of ±1), so the louder the more drive. The makeup gain takes it back for a
// reference, a sine with the peak of a note at the fx input: its loudness (RMS) stays the same at every
// drive. That is 1:1 with the drive while the reference passes the curve unclipped, then it levels off
// (about -9 dB: the RMS of a square of ±1 against the one of the reference). Louder sounds come out quieter
// than they went in, quieter ones louder: the curve compresses them, the level is the trim on top
export const REFERENCE_PEAK = 0.5;
// the drive range (FX_PARAMS.distortion.drive, not imported: it would bundle zod)
export const MAX_DRIVE = 24;
// dB between the table points, the gains in between are interpolated
const STEP = 0.25;
// points over a period of the reference
const POINTS = 128;

const REFERENCE_RMS = REFERENCE_PEAK / Math.SQRT2;

// dB of the makeup gain of a curve at the drive (dB)
const makeupDb = (shape: (x: number) => number, drive: number) => {
  const gain = 10 ** (drive / 20);
  let sum = 0;
  for (let i = 0; i < POINTS; i++) {
    const y = shape(gain * REFERENCE_PEAK * Math.sin((2 * Math.PI * i) / POINTS));
    sum += y * y;
  }
  return 20 * Math.log10(REFERENCE_RMS / Math.sqrt(sum / POINTS));
};

// by mode, from 0 dB up to MAX_DRIVE
const TABLES = DISTORTION_MODES.map(({ shape }) =>
  Float64Array.from({ length: MAX_DRIVE / STEP + 1 }, (_, i) => makeupDb(shape, i * STEP))
);

// the output gain of the mode (an index, as the param) at the drive (dB, clamped to its range)
export const makeupGain = (mode: number, drive: number) => {
  const table = TABLES[modeIndex(mode)];
  const position = number.thresholds(drive, 0, MAX_DRIVE) / STEP;
  const i = Math.min(Math.floor(position), table.length - 2);
  const db = table[i] + (table[i + 1] - table[i]) * (position - i);
  return 10 ** (db / 20);
};
