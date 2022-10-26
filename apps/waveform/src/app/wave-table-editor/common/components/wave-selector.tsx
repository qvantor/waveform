import React from 'react';
import styled from 'styled-components';
import { PlusOutlined } from '@ant-design/icons';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { theme, LineChart, Line } from '@waveform/ui-kit';
import { number } from '@waveform/math';
import { WavetableModel, WavetableActions } from '../modules';
import { ManualWavetableActions } from '../../manual-wavetable/modules';

const Root = styled.div`
  display: flex;
  gap: 4px;
  background: ${theme.colors.primaryDark};
  padding: 2px;
  margin-left: 70px; // place for handle, remove in future
`;

const Wave = styled.div<{ selected: boolean }>`
  width: 40px;
  height: 40px;
  border: 1px solid
    ${({ selected }) => (selected ? theme.colors.accent : theme.colors.primaryDarkHighContrast)};
`;
const NewWave = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  color: ${theme.colors.primaryDarkHighContrast};
  border: 2px solid transparent;
  transition: all 150ms;
  cursor: pointer;

  &:hover {
    border: 2px solid ${theme.colors.primaryDarkHighContrast};
  }
`;

type Props = Omit<WavetableModel, 'rateRange'> &
  Pick<WavetableActions, 'setCurrent'> &
  Partial<Pick<ManualWavetableActions, 'cloneCurrent'>>;

export const WaveSelector = ({ $waveTable, $current, $rate, $wave, setCurrent, cloneCurrent }: Props) => {
  const waveTable = useBehaviorSubject($waveTable);
  const rate = useBehaviorSubject($rate);
  useObservable($wave, []);
  return (
    <Root>
      {waveTable.map((wave, i) => {
        const croppedWave = [...wave.value].splice(0, number.powerOfTwo(rate));
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
    </Root>
  );
};
