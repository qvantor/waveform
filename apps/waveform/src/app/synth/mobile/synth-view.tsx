import React from 'react';
import styled from 'styled-components';
import { SynthSections } from './synth-sections';

const Root = styled.div`
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
`;

export const SynthView = ({ portrait }: { portrait: boolean }) => (
  <Root>
    <SynthSections layout={portrait ? 'column' : 'grid'} />
  </Root>
);
