import { Subject } from 'rxjs';
import { rxModel, rxModelReact, ObjectBS, PrimitiveBS } from '@waveform/rxjs-react';
import { Note, Notes } from '@waveform/ui-kit';

// the velocity of a note of the computer keyboard and of the piano on the screen (MIDI: 1..127)
export const DEFAULT_VELOCITY = 100;

// a note pressed and its velocity
export interface NoteOn {
  note: Note;
  velocity: number;
}

export const inputController = () =>
  rxModel(() => {
    const $onPress = new Subject<NoteOn>();
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
      9: [],
    });
    // the pitch bend: a share of its range, -1 (all the way down) .. 1 (up), 0 at rest; the MIDI input and the
    // wheel set it, the last one wins
    const $bend = new PrimitiveBS<number>(0);
    return { $pressed, $onPress, $onRelease, $bend };
  }).actions(({ $pressed, $onPress, $onRelease, $bend }) => ({
    onPress: (note: Note, velocity = DEFAULT_VELOCITY) => {
      if ($pressed.value[note[0]].includes(note[1])) return;
      $onPress.next({ note, velocity });
      const octave = $pressed.value[note[0]];
      $pressed.next({ ...$pressed.value, [note[0]]: [...octave, note[1]] });
    },
    onRelease: (note: Note) => {
      $onRelease.next(note);
      const octave = $pressed.value[note[0]];
      $pressed.next({ ...$pressed.value, [note[0]]: octave.filter((oNote) => oNote !== note[1]) });
    },
    setBend: (bend: number) => $bend.next(bend),
  }));

export const { ModelProvider: InputControllerProvider, useModel: useInputController } = rxModelReact(
  'inputController',
  inputController
);

export type InputControllerModule = ReturnType<typeof useInputController>;
