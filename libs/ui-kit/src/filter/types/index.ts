import { HandleProps } from '../../handle';

export type FilterNumerics = 'cutoff' | 'resonance' | 'gain';

export type FilterParams = {
  type: BiquadFilterType;
  cutoff: number;
  resonance: number;
  gain: number;
};

export type FilterRange = Required<Pick<HandleProps, 'min' | 'max'>> &
  Pick<HandleProps, 'precision' | 'mode' | 'plotSize' | 'disabled'>;
export type FilterRanges = Record<FilterNumerics, FilterRange>;

export type CommonFilterProps = FilterParams & {
  active?: boolean;
  sampleRate: number;
  setType: (value: BiquadFilterType) => void;
  setNumericValue: (key: FilterNumerics, value: number) => void;
  ranges: FilterRanges;
  // the modulation of each knob (its routes and drop target)
  modulation?: Partial<Record<FilterNumerics, Pick<HandleProps, 'modulations' | 'modTarget'>>>;
};

export type FilterProps = Pick<FilterParams, FilterNumerics>;
