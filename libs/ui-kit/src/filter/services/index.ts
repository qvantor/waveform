import { FilterProps } from '../types';

type ChartArray = [number, number][];

const emptyLine: ChartArray = [
  [10, 0],
  [22050, 0],
];

const lowpass = ({ resonance, cutoff }: FilterProps): ChartArray => [
  [10, 0],
  [cutoff - cutoff * 0.01, 0],
  [cutoff, resonance / 15],
  [cutoff + cutoff * 0.1, 0],
  [cutoff * 15, -1],
];

const highpass = ({ resonance, cutoff }: FilterProps): ChartArray => [
  [cutoff - cutoff * 0.93, -1],
  [cutoff - cutoff * 0.1, 0],
  [cutoff + cutoff * 0.07, resonance / 15],
  [cutoff, 0],
  [22050, 0],
];

const bandpass = ({ resonance, cutoff }: FilterProps): ChartArray => {
  const data: [number, number][] = [
    [(cutoff * resonance) / 1100, -1],
    [(cutoff * resonance) / 1100, -1],
    [cutoff - cutoff * 0.05, -resonance / 1100],
    [cutoff, 0],
    [cutoff, 0],
    [cutoff + cutoff * 0.05, -resonance / 1100],
    [cutoff / (resonance / 1100), -1],
    [cutoff / (resonance / 1100), -1],
    [22050, -1],
  ];
  if (data[0][0] > 10) data.unshift([10, -1]);
  return data;
};

const lowshelf = ({ gain, cutoff }: FilterProps): ChartArray => {
  const data: [number, number][] = [
    [cutoff - cutoff * 0.5, gain / 50],
    [cutoff - cutoff * 0.5, gain / 50],
    [cutoff + cutoff * 0.9, 0],
    [cutoff + cutoff * 0.9, 0],
    [22050, 0],
  ];
  if (data[0][0] > 10) data.unshift([10, gain / 50]);
  return data;
};

const highshelf = ({ gain, cutoff }: FilterProps): ChartArray => {
  const data: [number, number][] = [
    // [10, 0],
    [cutoff - cutoff * 0.5, 0],
    [cutoff - cutoff * 0.5, 0],
    [cutoff + cutoff * 0.9, gain / 50],
    [cutoff + cutoff * 0.9, gain / 50],
    [22050, gain / 50],
  ];
  if (data[0][0] > 10) data.unshift([10, 0]);
  return data;
};

const peaking = ({ gain, cutoff, resonance }: FilterProps): ChartArray => {
  if (resonance === 0) return emptyLine;
  const resNormalised = resonance / 12;
  return [
    [10, 0],
    [cutoff * resNormalised, 0],
    [cutoff * resNormalised, 0],
    [cutoff, gain / 40],
    [cutoff, gain / 40],
    [cutoff / resNormalised, 0],
    [cutoff / resNormalised, 0],
    [22050, 0],
  ];
};

export const getChartData = (type: BiquadFilterType, props: FilterProps): ChartArray => {
  switch (type) {
    case 'lowpass':
      return lowpass(props);
    case 'highpass':
      return highpass(props);
    case 'bandpass':
      return bandpass(props);
    case 'lowshelf':
      return lowshelf(props);
    case 'highshelf':
      return highshelf(props);
    case 'peaking':
      return peaking(props);
    default:
      return emptyLine;
  }
};
