import React from 'react';
import styled from 'styled-components';
import { useAppContext } from '../../app';
import { Handle, Analyser } from '@waveform/ui-kit';
import { number } from '@waveform/math';

const Root = styled.div`
  display: grid;
  grid-template-columns: 1fr 50px;
  gap: 20px;
`;

export const WaveAnalyser = () => {
  const {
    context: { analyser },
  } = useAppContext();
  const [fftSize, setFftSize] = React.useState(9);

  return (
    <Root>
      <Analyser analyser={analyser} fftSize={fftSize} />
      <div>
        <Handle
          min={5}
          max={12}
          value={fftSize}
          onChange={setFftSize}
          label='FFT Size'
          formatValue={(value) => `FFT: ${number.powerOfTwo(value)}`}
        />
      </div>
    </Root>
  );
};
