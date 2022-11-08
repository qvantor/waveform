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
  setType: (value: BiquadFilterType) => void;
  setNumericValue: (key: FilterNumerics, value: number) => void;
  ranges: FilterRanges;
};

export type FilterRouterProps = Pick<CommonFilterProps, FilterNumerics | 'type'>;

export type FilterProps = Pick<FilterRouterProps, FilterNumerics>;
