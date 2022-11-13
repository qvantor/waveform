import React from 'react';
import styled from 'styled-components';
import { PlusOutlined } from '@ant-design/icons';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { theme, LineChart, Line } from '@waveform/ui-kit';
import { number } from '@waveform/math';
import { WavetableModel, WavetableActions } from '../../modules';
import { ManualWavetableActions } from '../../../manual-wavetable/modules';
import { RxHandle } from '../../../../common/components';

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

const WavesPreview = styled.div`
  display: flex;
  gap: 4px;
  background: ${theme.colors.primaryDark};
  padding: 2px;
  overflow-x: scroll;
`;

const Wave = styled.div<{ selected: boolean }>`
  width: 59px;
  height: 59px;
  border: 1px solid
    ${({ selected }) => (selected ? theme.colors.accent : theme.colors.primaryDarkHighContrast)};
`;
const NewWave = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 57px;
  height: 57px;
  color: ${theme.colors.primaryDarkHighContrast};
  border: 2px solid transparent;
  transition: all 150ms;
  cursor: pointer;

  &:hover {
    border: 2px solid ${theme.colors.primaryDarkHighContrast};
  }
`;

export type Props = Omit<WavetableModel, 'rateRange'> &
  Pick<WavetableActions, 'setCurrent'> &
  Partial<Pick<ManualWavetableActions, 'cloneCurrent'>> & {
    withRate?: boolean;
  };

export const WaveSelector = ({
  $waveTable,
  $current,
  $rate,
  $wave,
  setCurrent,
  cloneCurrent,
  withRate = true,
}: Props) => {
  const waveTable = useBehaviorSubject($waveTable);
  const rate = useBehaviorSubject($rate);
  useObservable($wave, []);
  return (
    <Root>
      <HandlersWrapper>
        <RxHandle
          min={0}
          max={waveTable.length - 1}
          $value={$current}
          onChange={setCurrent}
          label='Wave'
          precision={1}
        />
      </HandlersWrapper>
      <WavesPreview>
        {waveTable.map((wave, i) => {
          const croppedWave = withRate ? [...wave.value].splice(0, number.powerOfTwo(rate)) : wave.value;
          return (
            <Wave key={i} onClick={() => setCurrent(i)} selected={i === $current.value}>
              <LineChart domainX={[0, croppedWave.length - 1]} domainY={[1, -1]} padding={[0, 0]}>
                <Line data={croppedWave} />
              </LineChart>
            </Wave>
          );
        })}
        {cloneCurrent && (
          <NewWave onClick={cloneCurrent}>
            <PlusOutlined />
          </NewWave>
        )}
      </WavesPreview>
    </Root>
  );
};
