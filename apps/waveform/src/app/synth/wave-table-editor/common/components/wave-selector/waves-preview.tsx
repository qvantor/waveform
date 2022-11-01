import React from 'react';
import styled from 'styled-components';
import { Line, LineChart, theme } from '@waveform/ui-kit';
import { PlusOutlined } from '@ant-design/icons';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { OscillatorActions, OscillatorModel } from '../../../../common/modules';
import { ManualWavetableActions } from '../../../manual-wavetable/modules';

const Root = styled.div`
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

export type Props = Pick<OscillatorModel, '$waveTable' | '$current'> &
  Pick<OscillatorActions, 'setCurrent'> &
  Partial<Pick<ManualWavetableActions, 'cloneCurrent'>>;

export const WavesPreview = ({ $waveTable, $current, cloneCurrent, setCurrent }: Props) => {
  const waveTable = useBehaviorSubject($waveTable);
  useBehaviorSubject($current);
  return (
    <Root>
      {waveTable.map((wave, i) => (
        <Wave key={i} onClick={() => setCurrent(i)} selected={i === $current.value}>
          <LineChart domainX={[0, wave.value.length - 1]} domainY={[1, -1]} padding={[0, 0]}>
            <Line data={wave.value} />
          </LineChart>
        </Wave>
      ))}
      {cloneCurrent && (
        <NewWave onClick={cloneCurrent}>
          <PlusOutlined />
        </NewWave>
      )}
    </Root>
  );
};
