import React from 'react';
import styled from 'styled-components';
import { Select } from '../select';
import { Handle } from '../handle';
import { CommonFilterProps, FilterNumerics, FilterRange, FilterRanges, FilterParams } from './types';
import { FilterResponse } from './components/filter-response';

export type { FilterNumerics, FilterParams, FilterRange, FilterRanges };
export { FilterResponse };

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

const Chart = styled(FilterResponse)`
  flex: 1 1;
`;

export const HandlersContainer = styled.div`
  display: flex;
  gap: 10px;
`;

export const Filter = ({
  type,
  setType,
  setNumericValue,
  ranges,
  active = true,
  sampleRate,
  cutoff,
  resonance,
  gain,
}: CommonFilterProps) => {
  const setValueInternal = (key: FilterNumerics) => (value: number) => setNumericValue(key, value);
  return (
    <Root>
      <Select value={type} options={options} onChange={setType} />
      <Chart
        type={type}
        cutoff={cutoff}
        resonance={resonance}
        gain={gain}
        sampleRate={sampleRate}
        active={active}
      />
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
