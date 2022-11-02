import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { AppModule } from '../../../app/modules';
import { InputControllerModule } from './input-controller';
import { filter, tap } from 'rxjs';
import { Note } from '@waveform/ui-kit';

interface Dependencies {
  app: AppModule;
  inputController: InputControllerModule;
}

const keyboardToNotes: Record<string, Note> = {
  KeyZ: [2, 'C'],
  KeyS: [2, 'C#'],
  KeyX: [2, 'D'],
  KeyD: [2, 'D#'],
  KeyC: [2, 'E'],
  KeyV: [2, 'F'],
  KeyG: [2, 'F#'],
  KeyB: [2, 'G'],
  KeyH: [2, 'G#'],
  KeyN: [2, 'A'],
  KeyJ: [2, 'A#'],
  KeyM: [2, 'B'],

  Comma: [3, 'C'],
  KeyL: [3, 'C#'],
  Period: [3, 'D'],
  Semicolon: [3, 'D#'],
  Slash: [3, 'E'],

  KeyQ: [3, 'C'],
  Digit2: [3, 'C#'],
  KeyW: [3, 'D'],
  Digit3: [3, 'D#'],
  KeyE: [3, 'E'],
  KeyR: [3, 'F'],
  Digit5: [3, 'F#'],
  KeyT: [3, 'G'],
  Digit6: [3, 'G#'],
  KeyY: [3, 'A'],
  Digit7: [3, 'A#'],
  KeyU: [3, 'B'],

  KeyI: [4, 'C'],
  Digit9: [4, 'C#'],
  KeyO: [4, 'D'],
  Digit0: [4, 'D#'],
  KeyP: [4, 'E'],
  BracketLeft: [4, 'F'],
  Equal: [4, 'F#'],
  BracketRight: [4, 'G'],
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
