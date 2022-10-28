import React from 'react';
import styled from 'styled-components';
import { useAudioProcessor } from '../../common/modules';
import { useManualWavetable } from '../modules';
import { WaveUpscaleProvider } from './modules';
import { Controls, OutputWave } from './components';

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
