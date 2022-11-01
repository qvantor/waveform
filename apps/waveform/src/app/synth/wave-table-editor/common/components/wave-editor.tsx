import React from 'react';
import styled from 'styled-components';
import { Handle, WaveDrawer } from '@waveform/ui-kit';
import { number } from '@waveform/math';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { RxHandle } from '../../../../common/components';
import { OscillatorModel } from '../../../common/modules';
import { ManualWavetableActions, ManualWavetableModel } from '../../manual-wavetable/modules';

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

type Props = Pick<OscillatorModel, '$wave'> &
  Pick<ManualWavetableModel, '$rate' | 'rateRange'> &
  Partial<Pick<ManualWavetableActions, 'updateCurrentWave' | 'setRate'>>;

export const WaveEditor = ({
  $wave,
  $rate,
  rateRange: [minRate, maxRate],
  updateCurrentWave,
  setRate,
}: Props) => {
  const wave = useObservable($wave, []);
  const rate = useBehaviorSubject($rate);
  const [precisionY, setPrecisionY] = React.useState(5);
  return (
    <Root>
      <HandlersWrapper>
        <RxHandle
          $value={$rate}
          onChange={setRate}
          rotateSpeed={20}
          min={minRate}
          max={Math.min(maxRate, number.getLogOfTwo(wave.length > 0 ? wave.length : 2))}
          formatValue={(value) => number.powerOfTwo(value)}
          label='Grid X'
        />
        <Handle
          step={[2, 5, 10, 20]}
          rotateSpeed={20}
          value={precisionY}
          onChange={setPrecisionY}
          label='Grid Y'
        />
      </HandlersWrapper>
      <WaveDrawer wave={wave} onChange={updateCurrentWave} rate={rate} precisionY={precisionY} />
    </Root>
  );
};
