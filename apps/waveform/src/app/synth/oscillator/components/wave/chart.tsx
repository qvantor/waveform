import React from 'react';
import styled from 'styled-components';
import { LineChart, Line, theme } from '@waveform/ui-kit';
import { useObservable } from '@waveform/rxjs-react';
import { useOscillatorContext } from '../../hooks';

const Root = styled(LineChart)`
  border-radius: 3px;
`;

// the wave the position plays: between two frames their morph
export const Chart = () => {
  const [{ $morphWave }] = useOscillatorContext();
  const wave = useObservable($morphWave, []);
  return (
    <Root padding={[-1, 2]} domainX={[0, wave.length - 1]} domainY={[1, -1]}>
      <Line data={[0, ...wave, 0]} style={{ fill: theme.colors.accent, fillOpacity: 0.3 }} />
    </Root>
  );
};
