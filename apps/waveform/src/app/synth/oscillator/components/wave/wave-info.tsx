import React from 'react';
import cls from 'classnames';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { useOscillatorContext } from '../../hooks';
import { Cell, Strip } from './value-strip';

// the frame of a position from 1, a fractional one (of a preset or a modulation) with one decimal
export const formatWavePosition = (position: number) =>
  Number.isInteger(position) ? `${position + 1}` : (position + 1).toFixed(1);

interface Props {
  // Phase or Phase rand is held (true) or let go (false)
  onPhaseActiveChange: (active: boolean) => void;
  // narrow: the values smaller
  compact: boolean;
}

// under the wave, on its background: the frame it plays of the frames played, Phase, Phase rand and Unison
// dragged to change them
export const WaveInfo = ({ onPhaseActiveChange, compact }: Props) => {
  const [{ $position, $frames, $osc, ranges }, { setOscValue }] = useOscillatorContext();
  const position = useBehaviorSubject($position);
  // the frames played, as the Wave knob: of a table with a morph mark its 256
  const frames = useBehaviorSubject($frames);
  const { phase, phaseRand, unison } = useBehaviorSubject($osc);
  return (
    <Strip $edge='bottom' className={cls({ compact })}>
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
      <Cell
        label='Unison'
        value={unison}
        min={ranges.unison[0]}
        max={ranges.unison[1]}
        precision={1}
        arrows
        onChange={(value) => setOscValue('unison', value)}
      />
    </Strip>
  );
};
