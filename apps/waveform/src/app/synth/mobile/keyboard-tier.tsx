import React from 'react';
import styled from 'styled-components';
import { AiOutlineDown, AiOutlineUp } from 'react-icons/ai';
import { IconButton, PianoKeyboard, theme, useElementSize } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { useInputController } from '../common/modules';

const OCTAVE_RANGE: [number, number] = [0, 8];

const Root = styled.div`
  display: flex;
  gap: 4px;
  min-height: 0;
  min-width: 0;
`;

const OctaveControl = styled.div`
  flex: 0 0 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;

  button {
    width: 36px;
    height: 36px;
    justify-content: center;
  }
`;

const OctaveLabel = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: ${theme.colors.primaryDarkMediumContrast};
`;

const Keys = styled.div`
  flex: 1 1;
  min-width: 0;
  position: relative;
  overflow: hidden;
`;

// out of the flow: keys are sized from the container, so they must not affect its size (feedback on rotation)
const KeysInner = styled.div`
  position: absolute;
  inset: 0;
`;

interface Props {
  octave: number;
  octavesCount: number;
  onOctaveChange: (octave: number) => void;
}

export const KeyboardTier = ({ octave: storedOctave, octavesCount, onOctaveChange }: Props) => {
  const [{ $pressed }, { onPress, onRelease }] = useInputController();
  const pressed = useBehaviorSubject($pressed);
  const [keysRef, [width, height]] = useElementSize<HTMLDivElement>();
  const maxOctave = OCTAVE_RANGE[1] - octavesCount + 1;
  // the stored octave may be out of range for the current octaves count (switch to landscape)
  const octave = number.thresholds(storedOctave, OCTAVE_RANGE[0], maxOctave);
  const shift = (diff: number) =>
    onOctaveChange(number.thresholds(octave + diff, OCTAVE_RANGE[0], maxOctave));

  return (
    <Root>
      <OctaveControl>
        <IconButton onClick={() => shift(1)} disabled={octave >= maxOctave}>
          <AiOutlineUp />
        </IconButton>
        <OctaveLabel>C{octave}</OctaveLabel>
        <IconButton onClick={() => shift(-1)} disabled={octave <= OCTAVE_RANGE[0]}>
          <AiOutlineDown />
        </IconButton>
      </OctaveControl>
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
    </Root>
  );
};
