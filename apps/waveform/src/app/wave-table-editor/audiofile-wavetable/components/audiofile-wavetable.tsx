import React from 'react';
import styled from 'styled-components';
import { AudiofileWavePickerProvider, useAudiofileWavetable } from '../modules';
import { WaveSelector } from '../../common/components';
import { AudiofileWavePicker } from './audiofile-wave-picker';
import { WavePreview } from './wave-preview';

const Root = styled.div`
  display: grid;
  grid-template-rows: 65px 1fr 1fr;
  gap: 20px;
  padding: 20px 20px 20px 0;
`;

interface Props {
  audioBuffer: Float32Array;
}

export const AudiofileWavetable = ({ audioBuffer }: Props) => {
  const audiofileWavetable = useAudiofileWavetable();
  const [{ rateRange, ...model }, { setCurrent }] = audiofileWavetable;
  return (
    <AudiofileWavePickerProvider initial={{ audioBuffer }} audiofileWavetable={audiofileWavetable}>
      <Root>
        <WaveSelector {...model} setCurrent={setCurrent} withRate={false} />
        <AudiofileWavePicker />
        <WavePreview />
      </Root>
    </AudiofileWavePickerProvider>
  );
};
