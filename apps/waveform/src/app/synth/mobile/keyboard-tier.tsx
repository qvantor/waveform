import React from 'react';
import { styled } from 'styled-components';
import { PianoKeyboard, useElementSize } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useInputController } from '../common/modules';

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
  // the octave it starts at, within `pianoStarts` of its count
  octave: number;
  octavesCount: number;
}

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
