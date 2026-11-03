import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { filter, skip, tap } from 'rxjs';
import { Note } from '@waveform/ui-kit';
import { number } from '@waveform/math';
import { AppModule } from '../../../app/modules';
import { readStored, writeStored } from '../../../common/services';
import { pianoStarts } from '../piano-octaves';
import { InputControllerModule } from './input-controller';

interface Dependencies {
  app: AppModule;
  inputController: InputControllerModule;
}

// the note of each key, its octave over the one of the bottom row
const keyboardToNotes: Record<string, Note> = {
  KeyZ: [0, 'C'],
  KeyS: [0, 'C#'],
  KeyX: [0, 'D'],
  KeyD: [0, 'D#'],
  KeyC: [0, 'E'],
  KeyV: [0, 'F'],
  KeyG: [0, 'F#'],
  KeyB: [0, 'G'],
  KeyH: [0, 'G#'],
  KeyN: [0, 'A'],
  KeyJ: [0, 'A#'],
  KeyM: [0, 'B'],

  Comma: [1, 'C'],
  KeyL: [1, 'C#'],
  Period: [1, 'D'],
  Semicolon: [1, 'D#'],
  Slash: [1, 'E'],

  KeyQ: [1, 'C'],
  Digit2: [1, 'C#'],
  KeyW: [1, 'D'],
  Digit3: [1, 'D#'],
  KeyE: [1, 'E'],
  KeyR: [1, 'F'],
  Digit5: [1, 'F#'],
  KeyT: [1, 'G'],
  Digit6: [1, 'G#'],
  KeyY: [1, 'A'],
  Digit7: [1, 'A#'],
  KeyU: [1, 'B'],

  KeyI: [2, 'C'],
  Digit9: [2, 'C#'],
  KeyO: [2, 'D'],
  Digit0: [2, 'D#'],
  KeyP: [2, 'E'],
  BracketLeft: [2, 'F'],
  Equal: [2, 'F#'],
  BracketRight: [2, 'G'],
};

// the octave of the bottom row (Z = C{o}, Q = C{o + 1}, ] = G{o + 2}): its three octaves on the piano; kept by the
// browser (localStorage), not by a preset: how the keys are played, not the sound
const KEYBOARD_OCTAVE_DEFAULT = 3;
export const KEYBOARD_OCTAVES = pianoStarts(3);
const OCTAVE_KEY = 'keyboardOctave';
const isOctave = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= KEYBOARD_OCTAVES[0] &&
  value <= KEYBOARD_OCTAVES[1];

const isShortcut = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;

// QWERTY input is suspended while typing into a text field (preset search, preset name, etc.);
// a focused select still plays: preventDefault cancels its type-ahead, the arrows are no notes
const isTextInput = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName));

const noteFilter = (e: KeyboardEvent) =>
  !isShortcut(e) && e.code in keyboardToNotes && !isTextInput(e.target);

const OCTAVE_KEYS: Record<string, number> = { ArrowDown: -1, ArrowUp: 1 };

// the arrows belong to the focused control: a text field (antd's select too), a native select, or a control that
// took them already (a fader, a strip of values, the point of a curve, antd's tabs: React handles them at its root,
// before the listeners of the document)
const takesArrows = (e: KeyboardEvent) =>
  e.defaultPrevented ||
  isTextInput(e.target) ||
  (e.target instanceof HTMLElement && e.target.tagName === 'SELECT');

const octaveFilter = (e: KeyboardEvent) => e.code in OCTAVE_KEYS && !isShortcut(e) && !takesArrows(e);

export const keyboardController = ({
  app: [{ $keyDown, $keyUp, $blur }],
  inputController: [, { onPress, onRelease }],
}: Dependencies) =>
  rxModel(() => ({
    $octave: new PrimitiveBS<number>(
      readStored('localStorage', OCTAVE_KEY, KEYBOARD_OCTAVE_DEFAULT, isOctave)
    ),
  }))
    .actions(({ $octave }) => {
      const setOctave = (octave: number) => {
        const next = number.thresholds(octave, ...KEYBOARD_OCTAVES);
        if (next !== $octave.value) $octave.next(next);
      };
      return { setOctave, shiftOctave: (diff: number) => setOctave($octave.value + diff) };
    })
    .subscriptions(({ $octave }, { shiftOctave }) => {
      // the note each key pressed: a keyup releases only its own (whatever the modifiers: a key pressed before Ctrl
      // or Cmd; the octave shifted meanwhile), not a note of another input; all of them once Cmd is released (macOS
      // sends no keyup of a key let go while Cmd is held) or the window loses focus
      const held = new Map<string, Note>();
      const release = (code: string) => {
        const note = held.get(code);
        if (!note) return;
        held.delete(code);
        onRelease(note);
      };
      const releaseAll = () => [...held.keys()].forEach(release);
      return [
        $octave.pipe(skip(1)).subscribe((octave) => writeStored('localStorage', OCTAVE_KEY, octave)),
        $keyDown
          .pipe(
            filter(noteFilter),
            tap((e) => e.preventDefault()),
            // the auto-repeat of a key held: it would press the note of an octave shifted since
            filter((e) => !held.has(e.code))
          )
          .subscribe((e) => {
            const [octave, name] = keyboardToNotes[e.code];
            const note: Note = [$octave.value + octave, name];
            held.set(e.code, note);
            onPress(note);
          }),
        // a step a press (not its auto-repeat), the page doesn't scroll
        $keyDown
          .pipe(
            filter(octaveFilter),
            tap((e) => e.preventDefault()),
            filter((e) => !e.repeat)
          )
          .subscribe((e) => shiftOctave(OCTAVE_KEYS[e.code])),
        $keyUp.subscribe((e) => (e.key === 'Meta' ? releaseAll() : release(e.code))),
        $blur.subscribe(releaseAll),
      ];
    });

export const { ModelProvider: KeyboardControllerProvider, useModel: useKeyboardController } = rxModelReact(
  'keyboardController',
  keyboardController
);
