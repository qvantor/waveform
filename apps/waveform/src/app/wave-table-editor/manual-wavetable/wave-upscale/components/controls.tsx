import React from 'react';
import styled from 'styled-components';
import { number } from '@waveform/math';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useWaveUpscale } from '../modules';
import { useManualWavetable } from '../../modules';
import { RxHandle } from '../../../../common/components';

const HandlersWrapper = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
`;

export const Controls = () => {
  const [{ $rate }] = useManualWavetable();
  const [{ $outputRate, $phase }, { setOutputRate, setPhase }] = useWaveUpscale();
  const rate = useBehaviorSubject($rate);
  return (
    <HandlersWrapper>
      <RxHandle
        min={rate}
        max={14}
        $value={$outputRate}
        rotateSpeed={10}
        onChange={setOutputRate}
        label='Output'
        formatValue={(value) => <>Out: {number.powerOfTwo(value)}</>}
      />
      <RxHandle
        $value={$phase}
        onChange={setPhase}
        formatValue={(value) => Math.round(value * 100) / 100}
        label='Phase'
      />
    </HandlersWrapper>
  );
};
