import React from 'react';
import styled from 'styled-components';
import { AiOutlineDown, AiOutlineUp } from 'react-icons/ai';
import { IconButton, PianoKeyboard, theme, useElementSize } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { useInputController } from '../common/modules';

const OCTAVE_RANGE: [number, number] = [0, 8];

// px of the octave buttons
export const OCTAVE_WIDTH = 36;

// the last octave a tier of octavesCount octaves may start at
const maxOctave = (octavesCount: number) => OCTAVE_RANGE[1] - octavesCount + 1;

// the octave a tier starts at: the stored one may be out of range for the current octaves count (switch to
// landscape)
export const tierOctave = (stored: number, octavesCount: number) =>
  number.thresholds(stored, OCTAVE_RANGE[0], maxOctave(octavesCount));

// as wide as its buttons
const Control = styled.div`
  flex: none;
  width: ${OCTAVE_WIDTH}px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;

  button {
    width: ${OCTAVE_WIDTH}px;
    height: ${OCTAVE_WIDTH}px;
    justify-content: center;
  }
`;

const OctaveLabel = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: ${theme.colors.primaryDarkMediumContrast};
`;

const Keys = styled.div`
  min-width: 0;
  position: relative;
  overflow: hidden;
`;

// out of the flow: keys are sized from the container, so they must not affect its size (feedback on rotation)
const KeysInner = styled.div`
  position: absolute;
  inset: 0;
`;

interface TierProps {
  // the octave it starts at, within the range (`tierOctave`)
  octave: number;
  octavesCount: number;
}

interface ControlProps extends TierProps {
  onOctaveChange: (octave: number) => void;
}

// the octave of a tier, ▲ and ▼ shift it
export const OctaveControl = ({ octave, octavesCount, onOctaveChange }: ControlProps) => {
  const shift = (diff: number) => onOctaveChange(tierOctave(octave + diff, octavesCount));
  return (
    <Control>
      <IconButton onClick={() => shift(1)} disabled={octave >= maxOctave(octavesCount)}>
        <AiOutlineUp />
      </IconButton>
      <OctaveLabel>C{octave}</OctaveLabel>
      <IconButton onClick={() => shift(-1)} disabled={octave <= OCTAVE_RANGE[0]}>
        <AiOutlineDown />
      </IconButton>
    </Control>
  );
};

// the keys of a tier: as wide and as high as its place
export const TierKeys = ({ octave, octavesCount }: TierProps) => {
  const [{ $pressed }, { onPress, onRelease }] = useInputController();
  const pressed = useBehaviorSubject($pressed);
  const [keysRef, [width, height]] = useElementSize<HTMLDivElement>();
  return (
    <Keys ref={keysRef}>
      <KeysInner>
        {width > 0 && (
          <PianoKeyboard
            octaves={[octave, octave + octavesCount - 1]}
            fitScreen={false}
            keyWidth={width / (7 * octavesCount)}
            keyHeight={height}
            pressed={pressed}
            onPress={onPress}
            onRelease={onRelease}
          />
        )}
      </KeysInner>
    </Keys>
  );
};
