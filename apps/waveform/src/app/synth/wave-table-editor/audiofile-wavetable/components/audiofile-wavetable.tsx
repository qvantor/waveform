import React from 'react';
import styled from 'styled-components';
import { useOscillatorContext } from '../../../oscillator';
import { WaveSelector } from '../../common/components';
import { AudiofileWavePicker } from './audiofile-wave-picker';
import { WavePreview } from './wave-preview';

const Root = styled.div`
  display: grid;
  grid-template-rows: 65px 1fr 1fr;
  gap: 20px;
  padding: 20px 20px 20px 0;
`;

export const AudiofileWavetable = () => {
  const [{ $waveTable, $current, $wave }, { setCurrent }] = useOscillatorContext();
  return (
    <Root>
      <WaveSelector $wave={$wave} $waveTable={$waveTable} $current={$current} setCurrent={setCurrent} />
      <AudiofileWavePicker />
      <WavePreview />
    </Root>
  );
};
