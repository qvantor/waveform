import React from 'react';
import styled from 'styled-components';
import { WaveUpscaleProvider } from './modules';
import { Controls, OutputWave } from './components';
import { useManualWavetable } from '../modules';
import { useAudioProcessor } from '../../wave-table-editor';

const Root = styled.div`
  display: grid;
  grid-template-columns: 70px 1fr;
`;

export const WaveUpscale = () => {
  const audioProcessor = useAudioProcessor();
  const manualWavetable = useManualWavetable();
  return (
    <WaveUpscaleProvider audioProcessor={audioProcessor} manualWavetable={manualWavetable} initial={{}}>
      <Root>
        <Controls />
        <OutputWave />
      </Root>
    </WaveUpscaleProvider>
  );
};
