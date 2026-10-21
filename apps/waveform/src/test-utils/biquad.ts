import { BiquadParams, coefficients } from '@waveform/math/biquad';

// a biquad of the coefficients of a BiquadFilterNode (libs/math), transposed direct form II, sample by sample:
// a filter of the specs (a band-limited noise, the response of a core)
export const createTestBiquad = (type: BiquadFilterType, params: BiquadParams, sampleRate: number) => {
  const [b0, b1, b2, a1, a2] = coefficients(type, params, sampleRate);
  let z1 = 0;
  let z2 = 0;
  return {
    process: (x: number) => {
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      return y;
    },
  };
};
