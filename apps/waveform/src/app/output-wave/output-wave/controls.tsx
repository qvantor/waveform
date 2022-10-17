import React from 'react';
import { Handle } from '@waveform/ui-kit';
import { number } from '@waveform/math';
import styled from 'styled-components';
import { useAppContext } from '../../app';
import { useBehaviorSubject } from '@waveform/rxjs';

const HandlersWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: space-between;
`;

export const Controls = () => {
  const {
    context: { $outputRate, $rate, $phase },
  } = useAppContext();
  const rate = useBehaviorSubject($rate);
  const phase = useBehaviorSubject($phase);
  const outputRate = useBehaviorSubject($outputRate);
  return (
    <HandlersWrapper>
      <Handle
        min={rate}
        max={13}
        value={outputRate}
        rotateSpeed={10}
        onChange={(value) => $outputRate.next(value)}
        label='Output'
        formatValue={(value) => <>Out: {number.powerOfTwo(value)}</>}
      />
      <Handle
        value={phase}
        onChange={(value) => {
          $phase.next(value);
        }}
        formatValue={(value) => Math.round(value * 100) / 100}
        label='Phase'
      />
    </HandlersWrapper>
  );
};
