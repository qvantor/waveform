import { styled } from 'styled-components';
import { PianoKeyboard, PITCH_WHEEL_WIDTH, theme, useElementSize } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { OctaveControl } from '../../common/components';
import { KEYBOARD_OCTAVES, useInputController, useKeyboardController } from '../common/modules';
import { pianoOctaves } from '../common/piano-octaves';
import { PitchBend } from '../pitch-bend';

// px of the keys: the row of the keys and the pitch bend
export const KEY_HEIGHT = 100;
// px of a white key at most, and at least while octaves are taken off (up to 5 from the one under the octave of
// the computer keyboard)
const KEY_WIDTH = 40;
const MIN_KEY_WIDTH = 36;
const MAX_OCTAVES = 5;

// the pitch bend left of the keys, as on a hardware keyboard: both as high as the row, a line between them as
// between the sections
const PianoContainer = styled.div`
  display: flex;
  gap: 1px;
  min-width: 0;
`;

// a section of its own, as the sections of the synth
const PitchSection = styled.div`
  display: flex;
  padding: 8px 12px 8px 8px;
  background: ${theme.colors.primary};
`;

// the octave of the computer keyboard right of the wheel, a section of its own: its plate as wide and as high as
// the slot of the wheel
const OctaveSection = styled(PitchSection)`
  padding: 8px;
`;

const KeyboardOctave = styled(OctaveControl)`
  width: ${PITCH_WHEEL_WIDTH}px;
`;

// the keys in the rest of the row, centered
const Keys = styled.div`
  flex: 1 1;
  min-width: 0;
  display: flex;
  justify-content: center;
`;

// the keys: they alone render on every note
const DesktopKeys = ({ octaves, keyWidth }: { octaves: [number, number]; keyWidth: number }) => {
  const [{ $pressed }, { onPress, onRelease }] = useInputController();
  const pressed = useBehaviorSubject($pressed);
  return (
    <PianoKeyboard
      onPress={onPress}
      onRelease={onRelease}
      pressed={pressed}
      octaves={octaves}
      fitScreen={false}
      keyWidth={keyWidth}
      keyHeight={KEY_HEIGHT}
    />
  );
};

// the bottom row of the desktop: the wheel, the octave of the computer keyboard and the octaves that fit beside
// them, their keys narrower rather than one octave fewer; they follow the octave of the computer keyboard, ▲ and ▼
// (or ↓ and ↑) shift both
export const DesktopPiano = () => {
  const [{ $octave }, { setOctave }] = useKeyboardController();
  const octave = useBehaviorSubject($octave);
  const [keysRef, [width]] = useElementSize<HTMLDivElement>();
  const octaves = Math.min(MAX_OCTAVES, Math.max(1, Math.floor(width / (7 * MIN_KEY_WIDTH))));
  return (
    <PianoContainer>
      <PitchSection>
        <PitchBend />
      </PitchSection>
      <OctaveSection>
        <KeyboardOctave
          octave={octave}
          range={KEYBOARD_OCTAVES}
          onOctaveChange={setOctave}
          label={`Computer keyboard octave: Z = C${octave}, Q = C${octave + 1}`}
        />
      </OctaveSection>
      <Keys ref={keysRef}>
        {width > 0 && (
          <DesktopKeys
            octaves={pianoOctaves(octave, octaves)}
            keyWidth={Math.min(KEY_WIDTH, width / (7 * octaves))}
          />
        )}
      </Keys>
    </PianoContainer>
  );
};
