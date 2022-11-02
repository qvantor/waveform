import React from 'react';
import styled from 'styled-components';
import { useScreenSize } from '../common/hooks';
import { Notes, Note } from '../common/types';
import { Octave } from './octave';

const Root = styled.div`
  display: flex;
`;

interface Props {
  pressed: Record<number, Notes[]>;
  octaves?: [number, number];
  onPress?: (note: Note) => void;
  onRelease?: (note: Note) => void;
}

export const PianoKeyboard = ({ octaves = [1, 5], onPress, onRelease, pressed }: Props) => {
  const [width] = useScreenSize();
  const octavesCount = Math.min(octaves[1], Math.floor(width / 280)) - octaves[0] + 1;
  const onPressInternal = (octave: number) => (note: Notes) => onPress?.([octave, note]);
  const onReleaseInternal = (octave: number) => (note: Notes) => onRelease?.([octave, note]);
  return (
    <Root>
      {[...Array(octavesCount)].map((_, i) => (
        <Octave
          key={i}
          onPress={onPressInternal(i + 1)}
          onRelease={onReleaseInternal(i + 1)}
          pressed={pressed[i + 1]}
        />
      ))}
    </Root>
  );
};
