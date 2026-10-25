import React from 'react';
import styled from 'styled-components';
import { animationFrameScheduler, auditTime } from 'rxjs';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
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

// the wheel: the bend of the input controller (a MIDI input moves it too), its tooltip in semitones. It renders
// alone with the bend, not the ranges beside it
const Wheel = () => {
  const [{ $bend }, { setBend }] = useInputController();
  const [{ $bendDown, $bendUp }] = useSynth();
  // once a frame: a MIDI input may send hundreds of bends a second
  const $shown = React.useMemo(() => $bend.pipe(auditTime(0, animationFrameScheduler)), [$bend]);
  const bend = useObservable($shown, $bend.value);
  const down = useBehaviorSubject($bendDown);
  const up = useBehaviorSubject($bendUp);
  return (
    <PitchWheel
      value={bend}
      onChange={setBend}
      formatValue={(value) => formatSemitones(bendCents(value, down, up) / 100)}
    />
  );
};

interface Props {
  // the wheel alone (the phone): the range is the preset's
  compact?: boolean;
}

// the pitch bend wheel left of the keys, as high as its place, and beside it its range up and down in semitones
// (the preset's)
export const PitchBend = ({ compact = false }: Props) => {
  const [{ $bendDown, $bendUp }, { setBendDown, setBendUp }] = useSynth();
  const down = useBehaviorSubject($bendDown);
  const up = useBehaviorSubject($bendUp);
  if (compact) return <Wheel />;
  return (
    <Root>
      <Ranges>
        <DraggableNumber value={up} range={[0, PITCH_BEND_MAX]} label='Up' onChange={setBendUp} />
        <DraggableNumber value={down} range={[0, PITCH_BEND_MAX]} label='Down' onChange={setBendDown} />
      </Ranges>
      <Wheel />
    </Root>
  );
};
