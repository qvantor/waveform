import { DISTORTION_MODES, modeIndex } from '../../effects/distortion-modes';

export const CURVE_POINTS = 65;

// the input of the chart, from -1 to 1 (full scale) left to right
export const curveInput = (i: number) => -1 + (2 * i) / (CURVE_POINTS - 1);

const INPUTS = Float64Array.from({ length: CURVE_POINTS }, (_, i) => curveInput(i));
const UNITY = new Float64Array(CURVE_POINTS).fill(1);

// the transfer curve of the mode at the drive (dB) into `out`: the output over the input, for the chart (drawn every
// frame while Drive is modulated: the loop of the mode, its curve inlined, no call per point). The makeup gain and
// the level are left out: they only scale the output, the shape is what the mode and the drive do, and a curve stays
// within ±1, so it always fits the chart
export const transferCurve = (mode: number, drive: number, out = new Float64Array(CURVE_POINTS)) => {
  const gain = 10 ** (drive / 20);
  for (let i = 0; i < CURVE_POINTS; i++) out[i] = gain * INPUTS[i];
  DISTORTION_MODES[modeIndex(mode)].shapeBlock(out, UNITY, CURVE_POINTS, out, false);
  return out;
};
