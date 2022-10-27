import React from 'react';
import styled from 'styled-components';
import { WaveEditor, WaveSelector } from '../../common/components';
import { useManualWavetable } from '../modules';
import { WaveUpscale } from '../wave-upscale';

const Root = styled.div`
  display: grid;
  grid-template-rows: 65px 1fr 1fr;
  gap: 20px;
  padding: 20px 20px 20px 0;
`;

export const ManualWavetable = () => {
  const [model, actions] = useManualWavetable();
  return (
    <Root>
      <WaveSelector {...model} {...actions} />
      <WaveEditor {...model} {...actions} />
      <WaveUpscale />
    </Root>
  );
};
