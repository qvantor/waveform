import React from 'react';
import styled from 'styled-components';
import { Handle, WaveDrawer } from '@waveform/ui-kit';
import { number } from '@waveform/math';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { RxHandle } from '../../../common/components';
import { WavetableModel, WavetableActions } from '../modules';
import { ManualWavetableActions } from '../../manual-wavetable/modules';

const Root = styled.div`
  display: grid;
  grid-template-columns: 70px 1fr;
`;

const HandlersWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: space-between;
  align-items: center;
`;

type Props = Pick<WavetableModel, '$wave' | '$rate' | 'rateRange'> &
  Pick<WavetableActions, 'setRate'> &
  Partial<Pick<ManualWavetableActions, 'updateCurrentWave'>>;

export const WaveEditor = ({
  $wave,
  $rate,
  rateRange: [minRate, maxRate],
  updateCurrentWave,
  setRate,
}: Props) => {
  const wave = useObservable($wave, []);
  const rate = useBehaviorSubject($rate);
  const [precision, setPrecision] = React.useState(5);
  return (
    <Root>
      <HandlersWrapper>
        <RxHandle
          $value={$rate}
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
      <WaveDrawer
        wave={wave}
        onChange={updateCurrentWave}
        rate={rate}
        precision={precision}
        range={[minRate, maxRate]}
      />
    </Root>
  );
};
