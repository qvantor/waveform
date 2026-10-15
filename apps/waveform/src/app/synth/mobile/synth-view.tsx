import React from 'react';
import styled from 'styled-components';
import { FxScreen } from '../fx';
import { SynthScreen } from '../screens';
import { SynthSections } from './synth-sections';

const Root = styled.div`
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
`;

// narrower charts: on a phone (360px and up) the filter or the decay group shares its line with the next one
const Fx = styled(FxScreen)`
  height: 100%;
  --fx-chart-width: 128px;
`;

export const SynthView = ({ portrait, screen }: { portrait: boolean; screen: SynthScreen }) => (
  <Root>
    {screen === 'fx' ? (
      <Fx layout={portrait ? 'column' : 'row'} />
    ) : (
      <SynthSections layout={portrait ? 'column' : 'grid'} />
    )}
  </Root>
);
