export type Numerics = 'cutoff' | 'resonance' | 'gain';

export interface CommonFilterProps {
  type: BiquadFilterType;
  cutoff: number;
  resonance: number;
  gain: number;
  setType: (value: BiquadFilterType) => void;
  setNumericValue: (key: Numerics, value: number) => void;
}

export type FilterRouterProps = Omit<CommonFilterProps, 'setNumericValue' | 'setType'> & {
  setNumericValue: (key: Numerics) => (value: number) => void;
};

export type FilterProps = Omit<FilterRouterProps, 'type'>;
