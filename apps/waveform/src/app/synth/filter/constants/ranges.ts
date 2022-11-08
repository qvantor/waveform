import { FilterNumerics, FilterRange, FilterRanges } from '@waveform/ui-kit';

export const defaultFilterRanges: FilterRanges = {
  cutoff: { min: 10, max: 22050, precision: 1, mode: 'log', plotSize: 200 },
  resonance: { min: 0, max: 20, precision: 10 },
  gain: { min: 0, max: 1, precision: 100 },
};

const disabled: Partial<FilterRange> = { min: -1000, max: 1000, disabled: true };

export const filterRanges: Record<BiquadFilterType, Partial<Record<FilterNumerics, Partial<FilterRange>>>> = {
  lowpass: {
    gain: disabled,
  },
  highpass: {
    gain: disabled,
  },
  bandpass: {
    resonance: { min: 0.01, max: 1000, precision: 100, mode: 'log' },
    gain: disabled,
  },
  lowshelf: {
    resonance: disabled,
    gain: { min: -40, max: 40 },
  },
  highshelf: {
    resonance: disabled,
    gain: { min: -40, max: 40 },
  },
  peaking: {
    gain: { min: 0, max: 40 },
    resonance: { min: 0, max: 10, precision: 100 },
  },
  notch: {
    gain: disabled,
    resonance: { min: 0.001, max: 10, precision: 10000, plotSize: 200, mode: 'log' },
  },
  allpass: {},
};
