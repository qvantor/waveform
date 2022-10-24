import React from 'react';
import styled from 'styled-components';
import { WaveUpscaleProvider } from './modules';
import { Controls, OutputWave } from './components';
import { useAudioProcessor } from '../wave-table-editor';
import { useWaveTable } from '../wave-table';

const Root = styled.div`
  display: grid;
  grid-template-columns: 50px 1fr;
  gap: 20px;
`;

export const WaveUpscale = () => {
  const audioProcessor = useAudioProcessor();
  const waveTable = useWaveTable();
  return (
    <WaveUpscaleProvider audioProcessor={audioProcessor} waveTable={waveTable} initial={{}}>
      <Root>
        <Controls />
        <OutputWave />
      </Root>
    </WaveUpscaleProvider>
  );
};
