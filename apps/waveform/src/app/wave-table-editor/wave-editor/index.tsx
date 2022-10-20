import React from 'react';
import styled from 'styled-components';
import { Handle, WaveDrawer } from '@waveform/ui-kit';
import { number } from '@waveform/math';

const Root = styled.div`
  display: grid;
  grid-template-columns: 50px 1fr;
  gap: 20px;
`;

const HandlersWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: space-between;
`;

interface Props {
  wave: number[];
  onChange?: (index: [number, number]) => void;
  rateRange: [number, number];
  rate: number;
  setRate: (value: number) => void;
}

export const WaveEditor = ({ wave, onChange, rateRange: [minRate, maxRate], rate, setRate }: Props) => {
  const [precision, setPrecision] = React.useState(5);
  return (
    <Root>
      <HandlersWrapper>
        <Handle
          value={rate}
          onChange={setRate}
          rotateSpeed={20}
          min={minRate}
          max={maxRate}
          formatValue={(value) => <>Rate: {number.powerOfTwo(value)}</>}
          label='Rate'
        />
        <Handle
          step={[2, 5, 10, 20]}
          rotateSpeed={20}
          value={precision}
          onChange={setPrecision}
          label='Precision'
        />
      </HandlersWrapper>
      <WaveDrawer wave={wave} onChange={onChange} rate={rate} precision={precision} />
    </Root>
  );
};
