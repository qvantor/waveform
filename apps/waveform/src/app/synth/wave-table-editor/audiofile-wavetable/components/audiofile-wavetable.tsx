import React from 'react';
import styled from 'styled-components';
import { WaveSelector } from '../../common/components';
import { AudiofileWavePicker } from './audiofile-wave-picker';
import { WavePreview } from './wave-preview';
import { useOscillator } from '../../../common/modules';

const Root = styled.div`
  display: grid;
  grid-template-rows: 65px 1fr 1fr;
  gap: 20px;
  padding: 20px 20px 20px 0;
`;

export const AudiofileWavetable = () => {
  const [{ $waveTable, $current }, { setCurrent }] = useOscillator();
  return (
    <Root>
      <WaveSelector $waveTable={$waveTable} $current={$current} setCurrent={setCurrent} />
      <AudiofileWavePicker />
      <WavePreview />
    </Root>
  );
};
