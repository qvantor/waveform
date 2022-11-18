import { Subject } from 'rxjs';
import { rxModel, rxModelReact , ObjectBS } from '@waveform/rxjs-react';
import { Note, Notes } from '@waveform/ui-kit';

const inputController = () =>
  rxModel(() => {
    const $onPress = new Subject<Note>();
    const $onRelease = new Subject<Note>();

    const $pressed = new ObjectBS<Record<number, Notes[]>>({
      '-1': [],
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
      7: [],
      8: [],
      9: []
    });
    return { $pressed, $onPress, $onRelease };
  }).actions(({ $pressed, $onPress, $onRelease }) => ({
    onPress: (note: Note) => {
      if ($pressed.value[note[0]].includes(note[1])) return;
      $onPress.next(note);
      const octave = $pressed.value[note[0]];
      $pressed.next({ ...$pressed.value, [note[0]]: [...octave, note[1]] });
    },
    onRelease: (note: Note) => {
      $onRelease.next(note);
      const octave = $pressed.value[note[0]];
      $pressed.next({ ...$pressed.value, [note[0]]: octave.filter((oNote) => oNote !== note[1]) });
    }
  }));

export const { ModelProvider: InputControllerProvider, useModel: useInputController } = rxModelReact(
  'inputController',
  inputController
);

export type InputControllerModule = ReturnType<typeof useInputController>;
