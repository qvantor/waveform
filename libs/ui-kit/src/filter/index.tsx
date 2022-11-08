import React from 'react';
import styled from 'styled-components';
import { Select } from '../select';
import { CommonFilterProps, FilterNumerics, FilterRange, FilterRanges, FilterParams } from './types';
import { Handle } from '../handle';
import { HandlersContainer, LineChartFilter } from './styles';
import { FilterLineChart } from './components/filter-linechart';
import { getChartData } from './services';

export type { FilterNumerics, FilterParams, FilterRange, FilterRanges };

const types: BiquadFilterType[] = [
  'lowpass',
  'highpass',
  'bandpass',
  'lowshelf',
  'highshelf',
  'peaking',
  'notch',
];
const options = types.map((value) => ({ name: value, value }));

const Root = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 5px;
`;

export const Filter = ({ type, setType, setNumericValue, ranges, ...rest }: CommonFilterProps) => {
  const setValueInternal = (key: FilterNumerics) => (value: number) => setNumericValue(key, value);
  const { cutoff, resonance, gain } = rest;
  return (
    <Root>
      <Select value={type} options={options} onChange={setType} />
      <LineChartFilter domainY={[1, -1]}>
        <FilterLineChart data={getChartData(type, rest)} />
      </LineChartFilter>
      <HandlersContainer>
        <Handle value={cutoff} onChange={setValueInternal('cutoff')} label='Cutoff' {...ranges.cutoff} />
        <Handle
          value={resonance}
          onChange={setValueInternal('resonance')}
          label='Res'
          {...ranges.resonance}
        />
        <Handle value={gain} onChange={setValueInternal('gain')} label='Gain' {...ranges.gain} />
      </HandlersContainer>
    </Root>
  );
};
