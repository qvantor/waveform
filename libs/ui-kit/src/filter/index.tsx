import React from 'react';
import styled from 'styled-components';
import { Select } from '../select';
import { CommonFilterProps, Numerics } from './types';
import { FilterRouter } from './components';

const types: BiquadFilterType[] = [
  'allpass',
  'bandpass',
  'highpass',
  'highshelf',
  'lowpass',
  'lowshelf',
  'notch',
  'peaking'
];
const options = types.map((value) => ({ name: value, value }));

const Root = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 5px;
`;

export const Filter = ({ type, setType, setNumericValue, ...rest }: CommonFilterProps) => {
  const setValueInternal = (key: Numerics) => (value: number) => setNumericValue(key, value);
  return (
    <Root>
      <Select value={type} options={options} onChange={setType} />
      <FilterRouter type={type} setNumericValue={setValueInternal} {...rest} />
    </Root>
  );
};
