import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { filter, tap } from 'rxjs';
import { Note } from '@waveform/ui-kit';
import { AppModule } from '../../../app/modules';
import { InputControllerModule } from './input-controller';

interface Dependencies {
  app: AppModule;
  inputController: InputControllerModule;
}

const keyboardToNotes: Record<string, Note> = {
  KeyZ: [3, 'C'],
  KeyS: [3, 'C#'],
  KeyX: [3, 'D'],
  KeyD: [3, 'D#'],
  KeyC: [3, 'E'],
  KeyV: [3, 'F'],
  KeyG: [3, 'F#'],
  KeyB: [3, 'G'],
  KeyH: [3, 'G#'],
  KeyN: [3, 'A'],
  KeyJ: [3, 'A#'],
  KeyM: [3, 'B'],

  Comma: [4, 'C'],
  KeyL: [4, 'C#'],
  Period: [4, 'D'],
  Semicolon: [4, 'D#'],
  Slash: [4, 'E'],

  KeyQ: [4, 'C'],
  Digit2: [4, 'C#'],
  KeyW: [4, 'D'],
  Digit3: [4, 'D#'],
  KeyE: [4, 'E'],
  KeyR: [4, 'F'],
  Digit5: [4, 'F#'],
  KeyT: [4, 'G'],
  Digit6: [4, 'G#'],
  KeyY: [4, 'A'],
  Digit7: [4, 'A#'],
  KeyU: [4, 'B'],

  KeyI: [5, 'C'],
  Digit9: [5, 'C#'],
  KeyO: [5, 'D'],
  Digit0: [5, 'D#'],
  KeyP: [5, 'E'],
  BracketLeft: [5, 'F'],
  Equal: [5, 'F#'],
  BracketRight: [5, 'G'],
};
const keyboardKeys = Object.keys(keyboardToNotes);

const keyFilter = (e: KeyboardEvent) => !e.metaKey && keyboardKeys.includes(e.code);

const keyboardController = ({
  app: [{ $keyDown, $keyUp }],
  inputController: [, { onPress, onRelease }],
}: Dependencies) =>
  rxModel({}).subscriptions(() => [
    $keyDown
      .pipe(
        filter(keyFilter),
        tap((e) => e.preventDefault())
      )
      .subscribe((e) => {
        onPress(keyboardToNotes[e.code]);
      }),
    $keyUp.pipe(filter(keyFilter)).subscribe((e) => {
      onRelease(keyboardToNotes[e.code]);
    }),
  ]);

export const { ModelProvider: KeyboardControllerProvider, useModel: useKeyboardController } = rxModelReact(
  'keyboardController',
  keyboardController
);
