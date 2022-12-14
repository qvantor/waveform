import React from 'react';
import styled from 'styled-components';
import { useOscillatorContext } from '../../../oscillator';
import { WaveSelector, WaveEditor } from '../../common/components';
import { useManualWavetable } from '../modules';

const Root = styled.div`
  display: grid;
  grid-template-rows: 65px 1fr;
  gap: 20px;
  padding: 20px 20px 20px 0;
`;

export const ManualWavetable = () => {
  const [{ $waveTable, $wave, $current }, { setCurrent }] = useOscillatorContext();
  const [{ $rate, rateRange }, { cloneCurrent, setRate, updateCurrentWave }] = useManualWavetable();
  return (
    <Root>
      <WaveSelector
        $wave={$wave}
        $waveTable={$waveTable}
        $current={$current}
        setCurrent={setCurrent}
        cloneCurrent={cloneCurrent}
      />
      <WaveEditor
        $wave={$wave}
        $rate={$rate}
        rateRange={rateRange}
        setRate={setRate}
        updateCurrentWave={updateCurrentWave}
      />
    </Root>
  );
};
