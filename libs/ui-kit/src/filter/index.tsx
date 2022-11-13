import React from 'react';
import styled from 'styled-components';
import { Select } from '../select';
import { Handle } from '../handle';
import { Deactivated } from '../common/styles';
import { CommonFilterProps, FilterNumerics, FilterRange, FilterRanges, FilterParams } from './types';
import { FilterLineChart } from './components/filter-linechart';
import { getChartData } from './services';
import { LineChart } from '../line-chart';

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

const ChartContainer = styled.div`
  position: relative;
  flex: 1 1;
  display: flex;
  border-radius: 3px;
`;

export const HandlersContainer = styled.div`
  display: flex;
  gap: 10px;
`;

export const LineChartFilter = styled(LineChart)`
  flex: 1 1;
  border-radius: 3px;
`;

export const Filter = ({
  type,
  setType,
  setNumericValue,
  ranges,
  active = true,
  ...rest
}: CommonFilterProps) => {
  const setValueInternal = (key: FilterNumerics) => (value: number) => setNumericValue(key, value);
  const { cutoff, resonance, gain } = rest;
  return (
    <Root>
      <Select value={type} options={options} onChange={setType} />
      <ChartContainer>
        {!active && <Deactivated />}
        <LineChartFilter domainY={[1, -1]}>
          <FilterLineChart data={getChartData(type, rest)} />
        </LineChartFilter>
      </ChartContainer>
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
