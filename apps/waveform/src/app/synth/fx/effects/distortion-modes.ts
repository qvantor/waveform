import { number } from '@waveform/math';

export interface DistortionMode {
  id: string;
  label: string;
  // the transfer curve, run on the 4× oversampled signal: odd, at most ±1 and with the slope 1 at 0, so
  // quiet signals pass unchanged and the drive alone sets how hard the curve is hit
  shape: (x: number) => number;
  // the curve over a block of points for the dsp: out[i] = shape(points[i]) × gains[i], added to out[i]
  // when `add`. Each mode has a loop of its own, so its curve is inlined into it: a loop shared by the
  // modes would call them through one polymorphic site, and V8 boxes every number such a call returns
  shapeBlock: (
    points: Float64Array,
    gains: Float64Array,
    length: number,
    out: Float64Array,
    add: boolean
  ) => void;
}

const hardClip = (x: number) => Math.max(-1, Math.min(1, x));

// the mode param is an index into this list: new modes are appended, the indexes are saved in presets.
// A curve with an even part (asymmetric) would add DC and need a DC blocker after it; one that is not a
// curve (bitcrush: sample and hold at a lower rate) a state of its own
export const DISTORTION_MODES: DistortionMode[] = [
  // tanh: rounds the peaks off, odd harmonics fading with their order
  {
    id: 'soft',
    label: 'Soft clip',
    shape: Math.tanh,
    shapeBlock: (points, gains, length, out, add) => {
      for (let i = 0; i < length; i++) {
        const y = Math.tanh(points[i]) * gains[i];
        out[i] = add ? out[i] + y : y;
      }
    },
  },
  // cuts at ±1: square edges, bright odd harmonics
  {
    id: 'hard',
    label: 'Hard clip',
    shape: hardClip,
    shapeBlock: (points, gains, length, out, add) => {
      for (let i = 0; i < length; i++) {
        const y = hardClip(points[i]) * gains[i];
        out[i] = add ? out[i] + y : y;
      }
    },
  },
];

export const modeIndex = (value: number) =>
  number.thresholds(Math.round(value), 0, DISTORTION_MODES.length - 1);
