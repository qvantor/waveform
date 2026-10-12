import React from 'react';
import styled from 'styled-components';
import { useScreenSize } from '../common/hooks';
import { Notes, Note } from '../common/types';
import { Octave } from './octave';

const Root = styled.div`
  display: flex;
  touch-action: none;
  -webkit-touch-callout: none;
`;

interface Props {
  pressed: Record<number, Notes[]>;
  octaves?: [number, number];
  // limit the octaves count by the screen width (desktop behaviour)
  fitScreen?: boolean;
  keyWidth?: number;
  keyHeight?: number;
  onPress?: (note: Note) => void;
  onRelease?: (note: Note) => void;
}

const NO_NOTES: Notes[] = [];

const noteFromPoint = (x: number, y: number): Note | undefined => {
  const element = document.elementFromPoint(x, y);
  const key = element instanceof HTMLElement ? element.closest<HTMLElement>('[data-note]') : null;
  if (!key?.dataset['note'] || !key.dataset['octave']) return undefined;
  return [Number(key.dataset['octave']), key.dataset['note'] as Notes];
};

const sameNote = (a?: Note, b?: Note) => a?.[0] === b?.[0] && a?.[1] === b?.[1];

// notes held by pointers of all mounted keyboards: several keyboards (mobile tiers) can show the same octave
const heldNotes = new Map<number, Note>();

export const PianoKeyboard = ({
  octaves = [1, 5],
  fitScreen = true,
  keyWidth = 40,
  keyHeight = 100,
  onPress,
  onRelease,
  pressed,
}: Props) => {
  const [width] = useScreenSize();
  const octavesCount = fitScreen
    ? Math.min(octaves[1], Math.floor(width / 280)) - octaves[0] + 1
    : octaves[1] - octaves[0] + 1;

  // every pointer (mouse, finger) holds at most one note; sliding a finger moves it to the key under it
  const pointers = React.useRef(new Map<number, Note>());
  const callbacks = React.useRef({ onPress, onRelease });
  callbacks.current = { onPress, onRelease };

  const release = React.useCallback((pointerId: number) => {
    const note = pointers.current.get(pointerId);
    if (!note) return;
    pointers.current.delete(pointerId);
    heldNotes.delete(pointerId);
    // another finger still holds the same key, on this or another keyboard
    if ([...heldNotes.values()].some((held) => sameNote(held, note))) return;
    callbacks.current.onRelease?.(note);
  }, []);

  const press = React.useCallback(
    (pointerId: number, note?: Note) => {
      if (sameNote(pointers.current.get(pointerId), note)) return;
      release(pointerId);
      if (!note) return;
      pointers.current.set(pointerId, note);
      heldNotes.set(pointerId, note);
      callbacks.current.onPress?.(note);
    },
    [release]
  );

  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      press(e.pointerId, noteFromPoint(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => release(e.pointerId);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    const active = pointers.current;
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      [...active.keys()].forEach(release);
    };
  }, [press, release]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // touch pointers are implicitly captured by the pressed key, notes are resolved by coordinates instead
    if (e.target instanceof Element && e.target.hasPointerCapture(e.pointerId))
      e.target.releasePointerCapture(e.pointerId);
    press(e.pointerId, noteFromPoint(e.clientX, e.clientY));
  };

  return (
    <Root onPointerDown={onPointerDown} onContextMenu={(e) => e.preventDefault()}>
      {[...Array(Math.max(octavesCount, 0))].map((_, i) => {
        const octave = octaves[0] + i;
        return (
          <Octave
            key={octave}
            octave={octave}
            pressed={pressed[octave] ?? NO_NOTES}
            keyWidth={keyWidth}
            keyHeight={keyHeight}
          />
        );
      })}
    </Root>
  );
};
