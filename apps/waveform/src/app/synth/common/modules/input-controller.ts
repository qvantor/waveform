import { filter, Subject } from 'rxjs';
import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { AppModule } from '../../../app/modules';
import { ObjectBS } from '@waveform/rxjs-react';
import { Note, Notes } from '@waveform/ui-kit';

interface Dependencies {
  app: AppModule;
}

// @todo separate inputController and keyboardController
const keyboardToNotes: Record<string, Note> = {
  KeyZ: [4, 'C'],
  KeyS: [4, 'C#'],
  KeyX: [4, 'D'],
  KeyD: [4, 'D#'],
  KeyC: [4, 'E'],
  KeyV: [4, 'F'],
  KeyG: [4, 'F#'],
  KeyB: [4, 'G'],
  KeyH: [4, 'G#'],
  KeyN: [4, 'A'],
  KeyJ: [4, 'A#'],
  KeyM: [4, 'B'],
};
const keyboardKeys = Object.keys(keyboardToNotes);

const keyFilter = (e: KeyboardEvent) => keyboardKeys.includes(e.code);

const inputController = ({ app: [{ $keyDown, $keyUp }] }: Dependencies) =>
  rxModel(() => {
    const $onPress = new Subject<Note>();
    const $onRelease = new Subject<Note>();

    const $pressed = new ObjectBS<Record<number, Notes[]>>({
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
      7: [],
    });
    return { $pressed, $onPress, $onRelease };
  })
    .actions(({ $pressed, $onPress, $onRelease }) => ({
      onPress: (note: Note) => {
        $onPress.next(note);
        const octave = $pressed.value[note[0]];
        $pressed.next({ ...$pressed.value, [note[0]]: [...octave, note[1]] });
      },
      onRelease: (note: Note) => {
        $onRelease.next(note);
        const octave = $pressed.value[note[0]];
        $pressed.next({ ...$pressed.value, [note[0]]: octave.filter((oNote) => oNote !== note[1]) });
      },
    }))
    .subscriptions((_, { onPress, onRelease }) => [
      $keyDown.pipe(filter(keyFilter)).subscribe((e) => {
        onPress(keyboardToNotes[e.code]);
      }),
      $keyUp.pipe(filter(keyFilter)).subscribe((e) => {
        onRelease(keyboardToNotes[e.code]);
      }),
    ]);

export const { ModelProvider: InputControllerProvider, useModel: useInputController } = rxModelReact(
  'inputController',
  inputController
);

export type InputControllerModule = ReturnType<typeof useInputController>;
