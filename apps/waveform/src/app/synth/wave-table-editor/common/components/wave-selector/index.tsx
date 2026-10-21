import React from 'react';
import styled from 'styled-components';
import { PlusOutlined } from '@ant-design/icons';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { theme, LineChart, Line, Handle } from '@waveform/ui-kit';
import { ManualWavetableActions } from '../../../manual-wavetable/modules';
import { OscillatorModel, OscillatorActions } from '../../../../common/modules';
import { frameIndex, framePosition } from '../../../../common/modules/oscillator';
import { MAX_FRAMES } from '../../../../common/wavetable/wavetable-mipmap';

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
const NewWave = styled.button`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 57px;
  height: 57px;
  padding: 0;
  color: ${theme.colors.primaryDarkHighContrast};
  background: none;
  border: 2px solid transparent;
  transition: all 150ms;
  cursor: pointer;

  &:hover:not(:disabled) {
    border: 2px solid ${theme.colors.primaryDarkHighContrast};
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
`;

export type Props = Pick<OscillatorModel, '$waveTable' | '$position' | '$wave' | '$morph'> &
  Pick<OscillatorActions, 'setPosition'> &
  Partial<Pick<ManualWavetableActions, 'cloneCurrent'>>;

// the frames of the table: the editors work on the one of the position (the nearest), choosing one sets the
// position to it (where it plays alone, of an expanded table among the 256)
export const WaveSelector = ({ $waveTable, $position, $wave, $morph, setPosition, cloneCurrent }: Props) => {
  const waveTable = useBehaviorSubject($waveTable);
  const morph = useBehaviorSubject($morph);
  const current = frameIndex(useBehaviorSubject($position), waveTable.length, morph);
  const select = (j: number) => setPosition(framePosition(j, waveTable.length, morph));
  useObservable($wave, []);
  return (
    <Root>
      <HandlersWrapper>
        <Handle
          min={0}
          max={waveTable.length - 1}
          value={current}
          onChange={(value) => select(Math.round(value))}
          label='Wave'
          name='Wave frame'
          precision={1}
          formatValue={(value) => `${value + 1}`}
        />
      </HandlersWrapper>
      <WavesPreview>
        {waveTable.map((wave, i) => (
          <Wave key={i} onClick={() => select(i)} selected={i === current}>
            <LineChart domainX={[0, wave.value.length - 1]} domainY={[1, -1]} padding={[0, 0]}>
              <Line data={wave.value} />
            </LineChart>
          </Wave>
        ))}
        {cloneCurrent && (
          <NewWave
            type='button'
            aria-label='Add a wave'
            onClick={cloneCurrent}
            disabled={waveTable.length >= MAX_FRAMES}
            title={
              waveTable.length >= MAX_FRAMES ? `A table holds ${MAX_FRAMES} waves at most` : 'Add a wave'
            }
          >
            <PlusOutlined />
          </NewWave>
        )}
      </WavesPreview>
    </Root>
  );
};
