import React from 'react';
import styled from 'styled-components';
import { LineChart, Line } from '@waveform/ui-kit';
import { useObservable } from '@waveform/rxjs-react';
import { useOscillatorContext } from '../../hooks';

const Root = styled(LineChart)`
  border-radius: 3px;
`

export const Chart = () => {
  const [{ $wave }] = useOscillatorContext();
  const wave = useObservable($wave, []);
  return (
    <Root domainX={[0, wave.length - 1]} domainY={[1, -1]}>
      <Line data={wave} />
    </Root>
  );
};
