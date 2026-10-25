import React from 'react';
import styled from 'styled-components';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { DraggableNumber, PitchWheel } from '@waveform/ui-kit';
import { number } from '@waveform/math';
import { PITCH_BEND_MAX } from '@waveform/preset-schema';
import { useInputController, useSynth } from '../common/modules';
import { bendCents } from '../common/modules/synth';

const Root = styled.div`
  display: flex;
  align-items: stretch;
  gap: 6px;
`;

// the range up at the top of the wheel, down at its bottom
const Ranges = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: stretch;
`;

// +1.5 st, -12 st, 0 st
const formatSemitones = (semitones: number) => {
  const rounded = number.round(semitones, 10);
  return `${rounded > 0 ? '+' : ''}${rounded} st`;
};

interface Props {
  // px of the wheel
  height: number;
  // the wheel alone (the phone): the range is the preset's
  compact?: boolean;
}

// the pitch bend wheel left of the keys: the bend of the input controller (a MIDI input moves it too) and, beside
// it, its range up and down in semitones (the preset's)
export const PitchBend = ({ height, compact = false }: Props) => {
  const [{ $bend }, { setBend }] = useInputController();
  const [{ $bendDown, $bendUp }, { setBendDown, setBendUp }] = useSynth();
  const bend = useBehaviorSubject($bend);
  const down = useBehaviorSubject($bendDown);
  const up = useBehaviorSubject($bendUp);
  const wheel = (
    <PitchWheel
      value={bend}
      onChange={setBend}
      height={height}
      formatValue={(value) => formatSemitones(bendCents(value, down, up) / 100)}
    />
  );
  if (compact) return wheel;
  return (
    <Root>
      <Ranges>
        <DraggableNumber value={up} range={[0, PITCH_BEND_MAX]} label='Up' onChange={setBendUp} />
        <DraggableNumber value={down} range={[0, PITCH_BEND_MAX]} label='Down' onChange={setBendDown} />
      </Ranges>
      {wheel}
    </Root>
  );
};
