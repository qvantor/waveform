import { scaleLinear, scaleLog, scalePow, ScaleContinuousNumeric } from 'd3-scale';

// how a knob or a fader spreads its range over its travel: linear, log (frequencies: an octave is the same
// travel everywhere) or pow (times from 0: the value goes as the travel^(1 / POW_EXPONENT), short times get
// most of the travel: the envelope times)
export type ScaleMode = 'linear' | 'log' | 'pow';

// a quarter of the travel for the first 1/256 of the range: of 32 s, 125 ms; the middle is 2 s
const POW_EXPONENT = 0.25;

export const valueScale = (mode: ScaleMode): ScaleContinuousNumeric<number, number> => {
  if (mode === 'log') return scaleLog();
  if (mode === 'pow') return scalePow().exponent(POW_EXPONENT);
  return scaleLinear();
};
