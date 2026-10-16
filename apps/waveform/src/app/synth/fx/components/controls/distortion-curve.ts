import { DISTORTION_MODES, modeIndex } from '../../effects/distortion-modes';

export const CURVE_POINTS = 65;

// the input of the chart, from -1 to 1 (full scale) left to right
export const curveInput = (i: number, points = CURVE_POINTS) => -1 + (2 * i) / (points - 1);

// the transfer curve of the mode at the drive (dB): the output over the input, for the chart. The makeup
// gain and the level are left out: they only scale the output, the shape is what the mode and the drive
// do, and a curve stays within ±1, so it always fits the chart
export const transferCurve = (mode: number, drive: number, points = CURVE_POINTS) => {
  const { shape } = DISTORTION_MODES[modeIndex(mode)];
  const gain = 10 ** (drive / 20);
  return Array.from({ length: points }, (_, i) => shape(gain * curveInput(i, points)));
};
