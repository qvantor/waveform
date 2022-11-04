import React from 'react';
import styled from 'styled-components';
import { Handle } from '../handle';

type Numerics = 'cutoff' | 'resonance' | 'gain';

interface Props {
  type: BiquadFilterType;
  cutoff: number;
  resonance: number;
  gain: number;
  setType: (value: BiquadFilterType) => void;
  setNumericValue: (key: Numerics, value: number) => void;
}

const HandlersContainer = styled.div`
  display: flex;
  gap: 10px;
`;

const types: BiquadFilterType[] = [
  'allpass',
  'bandpass',
  'highpass',
  'highshelf',
  'lowpass',
  'lowshelf',
  'notch',
  'peaking',
];

export const Filter = ({ type, resonance, cutoff, gain, setType, setNumericValue }: Props) => {
  const setValueInternal = (key: Numerics) => (value: number) => setNumericValue(key, value);
  return (
    <div>
      <select value={type} onChange={(e) => setType(e.target.value as BiquadFilterType)}>
        {types.map((filter) => (
          <option key={filter} value={filter}>
            {filter}
          </option>
        ))}
      </select>
      <HandlersContainer>
        <Handle
          value={cutoff}
          min={10}
          max={20000}
          precision={1}
          onChange={setValueInternal('cutoff')}
          label='Cutoff'
          mode='log'
        />
        <Handle
          value={resonance}
          min={0}
          max={100}
          precision={1}
          onChange={setValueInternal('resonance')}
          label='Res'
        />
        <Handle
          value={gain}
          min={0}
          max={1}
          precision={100}
          onChange={setValueInternal('gain')}
          label='Gain'
        />
      </HandlersContainer>
    </div>
  );
};
