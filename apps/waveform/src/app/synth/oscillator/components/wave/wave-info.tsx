import React from 'react';
import styled from 'styled-components';
import { DragValue, theme } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { useOscillatorContext } from '../../hooks';

// the bottom of the block of the wave: a line over it and between its values
const Root = styled.div`
  display: flex;
  border-top: 1px solid ${theme.colors.primaryDarkMediumContrast};
  border-radius: 0 0 3px 3px;
  overflow: hidden;
`;

// each value as wide as the others, the whole cell is dragged
const Cell = styled(DragValue)`
  flex: 1 1 0;
  justify-content: center;
  padding: 6px 7px;
  border-radius: 0;

  & + & {
    border-left: 1px solid ${theme.colors.primaryDarkMediumContrast};
  }
`;

// the frame of a position from 1, a fractional one (of a preset or a modulation) with one decimal
export const formatWavePosition = (position: number) =>
  Number.isInteger(position) ? `${position + 1}` : (position + 1).toFixed(1);

interface Props {
  // Phase or Phase rand is held (true) or let go (false)
  onPhaseActiveChange: (active: boolean) => void;
}

// under the wave, on its background: the frame it plays of the table, Phase and Phase rand dragged to change them
export const WaveInfo = ({ onPhaseActiveChange }: Props) => {
  const [{ $position, $waveTable, $osc, ranges }, { setOscValue }] = useOscillatorContext();
  const position = useBehaviorSubject($position);
  const frames = useBehaviorSubject($waveTable).length;
  const { phase, phaseRand } = useBehaviorSubject($osc);
  return (
    <Root>
      <Cell label='Wave' value={position} formatValue={(value) => `${formatWavePosition(value)}/${frames}`} />
      <Cell
        label='Phase'
        value={phase}
        min={ranges.phase[0]}
        max={ranges.phase[1]}
        cyclic
        precision={360}
        formatValue={(value) => `${Math.round(value * 360)}°`}
        onChange={(value) => setOscValue('phase', value)}
        onActiveChange={onPhaseActiveChange}
      />
      <Cell
        label='Phase rand'
        value={phaseRand}
        min={ranges.phaseRand[0]}
        max={ranges.phaseRand[1]}
        precision={100}
        formatValue={number.percent}
        onChange={(value) => setOscValue('phaseRand', value)}
        onActiveChange={onPhaseActiveChange}
      />
    </Root>
  );
};
