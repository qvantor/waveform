import React from 'react';
import styled from 'styled-components';
import { WaveAnalyser } from './wave-analyser';
import { OutputWave as OutputWaveInternal } from './output-wave';

const Root = styled.div`
  flex: 1 1;
  display: grid;
  grid-template-columns: 50px 1fr 1fr;
  gap: 20px;
`;

export const OutputWave = () => {
  return (
    <Root>
      <OutputWaveInternal />
      <WaveAnalyser />
    </Root>
  );
};
