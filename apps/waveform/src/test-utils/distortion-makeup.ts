import { number } from '@waveform/math';
import { DISTORTION_MODES, modeIndex } from '../app/synth/fx/effects/distortion-modes';
import { REFERENCE_PEAK } from '../app/synth/fx/effects/distortion-params';

// the makeup gains of the distortion as its tables were worked out (MAKEUP_TABLES of dsp/dsp-core/src/consts.rs):
// the specs expect them of the Rust core. The drive pushes the sound into the ceiling of the curve: the peaks stop
// growing there, but the waves get denser (towards a square of ±1), so the louder the more drive. The makeup gain
// takes it back for a reference, a sine with the peak of a note at the fx input (REFERENCE_PEAK): its loudness
// (RMS) stays the same at every drive. That is 1:1 with the drive while the reference passes the curve unclipped,
// then it levels off (towards -9 dB, the RMS of a square of ±1 against the one of the reference: -7.1 dB for soft
// clip and -8 dB for hard clip at the top of the drive)

// the drive range (FX_PARAMS.distortion.drive, not imported: it would bundle zod)
export const MAX_DRIVE = 12;
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

// dB by mode, from 0 dB up to MAX_DRIVE every STEP
const MAKEUP_TABLES = DISTORTION_MODES.map(({ shape }) =>
  Float64Array.from({ length: MAX_DRIVE / STEP + 1 }, (_, i) => makeupDb(shape, i * STEP))
);

// the output gain of the mode (an index, as the param) at the drive (dB, clamped to its range)
export const makeupGain = (mode: number, drive: number) => {
  const table = MAKEUP_TABLES[modeIndex(mode)];
  const position = number.thresholds(drive, 0, MAX_DRIVE) / STEP;
  const i = Math.min(Math.floor(position), table.length - 2);
  const db = table[i] + (table[i + 1] - table[i]) * (position - i);
  return 10 ** (db / 20);
};
