import React from 'react';
import styled from 'styled-components';
import { LineChart, Line } from '@waveform/ui-kit';
import { number } from '@waveform/math';
import { RxHandle } from '../../../../common/components';
import { useAudiofileWavePicker } from '../../modules';
import { Pickers } from './pickers';

const Root = styled.div`
  display: grid;
  grid-template-columns: 70px 1fr;
`;

const HandlersWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: space-between;
  align-items: center;
`;

export const AudiofileWavePicker = () => {
  const [
    { audioBuffer, waveSizeRange, $wavesPickersCount, pickersCountRange, $waveSize },
    { setWavesPickersCount, setWaveSize },
  ] = useAudiofileWavePicker();
  return (
    <Root>
      <HandlersWrapper>
        <RxHandle
          min={pickersCountRange[0]}
          max={pickersCountRange[1]}
          $value={$wavesPickersCount}
          onChange={setWavesPickersCount}
          formatValue={(value) => `Waves count: ${value}`}
          label='W Count'
          precision={1}
        />
        <RxHandle
          min={waveSizeRange[0]}
          max={waveSizeRange[1]}
          $value={$waveSize}
          onChange={setWaveSize}
          label='Size'
          formatValue={number.powerOfTwo}
          precision={1}
        />
      </HandlersWrapper>
      <LineChart domainY={[-1, 1]} domainX={[0, audioBuffer.length]}>
        <Line data={[...audioBuffer]} style={{ strokeWidth: 1 }} />
        <Pickers />
      </LineChart>
    </Root>
  );
};
