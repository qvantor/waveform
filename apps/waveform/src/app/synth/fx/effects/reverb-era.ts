import { number } from '@waveform/math';

export interface ReverbEra {
  id: string;
  label: string;
  // tube drive of the input stage, 0: clean
  drive: number;
  // lowpass of the input (Hz) like the converters of the old units, null: the full band
  bandwidth: number | null;
  // peaking boost (dB) at BODY_FREQ
  body: number;
}

// the era param is an index into this list, like the color modes of Valhalla VintageVerb;
// the 80s units were clean but band-limited, the 70s ones darker with a touch of tube.
// The drive is set for synth levels (chord peaks 1..3): more turns chords into intermodulation whistles
export const REVERB_ERAS: ReverbEra[] = [
  { id: 'now', label: 'Now', drive: 0, bandwidth: null, body: 0 },
  { id: '80s', label: '80s', drive: 0, bandwidth: 10000, body: 1 },
  { id: '70s', label: '70s', drive: 0.15, bandwidth: 6500, body: 2 },
];

export const eraIndex = (value: number) => number.thresholds(Math.round(value), 0, REVERB_ERAS.length - 1);

export const BODY_FREQ = 300;
export const BODY_Q = 0.7;

// the tube takes the input up to ±TUBE_RANGE, louder peaks are clipped
export const TUBE_RANGE = 8;
// operating point on the tanh: the curve is asymmetric, it adds even harmonics like a single-ended triode
const TUBE_BIAS = 0.3;
const TUBE_OFFSET = Math.tanh(TUBE_BIAS);
// below this drive the curve is a straight line within float precision
const MIN_DRIVE = 1e-4;

// the slope at 0 is 1 for every drive: quiet signals pass unchanged, louder ones get the 2nd and then
// the 3rd harmonic and are softly compressed; drive 0 is a straight line, and the curve bends into it
// continuously, so a gliding drive doesn't click
export const tube = (input: number, drive: number) => {
  const x = Math.max(-TUBE_RANGE, Math.min(TUBE_RANGE, input));
  if (drive < MIN_DRIVE) return x;
  return (Math.tanh(drive * x + TUBE_BIAS) - TUBE_OFFSET) / (drive * (1 - TUBE_OFFSET ** 2));
};
