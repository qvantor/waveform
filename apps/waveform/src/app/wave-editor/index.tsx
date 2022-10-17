import React from 'react';
import styled from 'styled-components';
import { Handle, WaveDrawer } from '@waveform/ui-kit';
import { number } from '@waveform/math';
import { useBehaviorSubject } from '@waveform/rxjs';
import { useAppContext } from '../app';

const Root = styled.div`
  flex: 1 1;
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

export const WaveEditor = () => {
  const {
    context: { maxRate, $wave, $rate },
  } = useAppContext();
  const wave = useBehaviorSubject($wave);
  const rate = useBehaviorSubject($rate);
  const [precision, setPrecision] = React.useState(5);
  const onChange = React.useCallback(
    (value: [number, number]) => {
      $wave.setValue(value);
    },
    [$wave]
  );
  return (
    <Root>
      <HandlersWrapper>
        <Handle
          value={rate}
          onChange={(value) => $rate.next(value)}
          rotateSpeed={20}
          min={2}
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
