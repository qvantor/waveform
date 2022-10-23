import React from 'react';
import styled from 'styled-components';
import { Handle } from '@waveform/ui-kit';
import { number } from '@waveform/math';
import { useBehaviorSubject } from '@waveform/rxjs';
import { useWaveUpscale } from '../modules';
import { useWaveTableModule } from '../../wave-table';

const HandlersWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: space-between;
`;

export const Controls = () => {
  const { $rate } = useWaveTableModule().context;
  const {
    context: { $outputRate, $phase },
    actions: { setOutputRate, setPhase },
  } = useWaveUpscale();
  const rate = useBehaviorSubject($rate);
  const phase = useBehaviorSubject($phase);
  const outputRate = useBehaviorSubject($outputRate);
  return (
    <HandlersWrapper>
      <Handle
        min={rate}
        max={14}
        value={outputRate}
        rotateSpeed={10}
        onChange={setOutputRate}
        label='Output'
        formatValue={(value) => <>Out: {number.powerOfTwo(value)}</>}
      />
      <Handle
        value={phase}
        onChange={setPhase}
        formatValue={(value) => Math.round(value * 100) / 100}
        label='Phase'
      />
    </HandlersWrapper>
  );
};
