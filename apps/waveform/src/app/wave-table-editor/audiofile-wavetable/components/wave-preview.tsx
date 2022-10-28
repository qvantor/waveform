import React from 'react';
import { useObservable } from '@waveform/rxjs-react';
import { LineChart, Line, XAxis, YAxis } from '@waveform/ui-kit';
import { useAudiofileWavePicker, useAudiofileWavetable } from '../modules';
import styled from 'styled-components';
import { RxHandle } from '../../../common/components';

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

export const WavePreview = () => {
  const [{ $wave }] = useAudiofileWavetable();
  const [{ $phase }, { setPhase }] = useAudiofileWavePicker();
  const wave = useObservable($wave, []);
  return (
    <Root>
      <HandlersWrapper>
        <RxHandle $value={$phase} onChange={setPhase} label='Phase' />
      </HandlersWrapper>
      <LineChart domainY={[-1, 1]} domainX={[0, wave.length - 1]}>
        <XAxis ticks={10} />
        <YAxis ticks={10} />
        <Line data={wave} />
      </LineChart>
    </Root>
  );
};
