import { fromEvent, filter, tap } from 'rxjs';
import toast from 'react-hot-toast';
import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { saveUrlSnapshot } from '../plugins/snapshot';

const appModel = () => {
  return rxModel(() => ({
    $keyDown: fromEvent<KeyboardEvent>(document, 'keydown'),
    $keyUp: fromEvent<KeyboardEvent>(document, 'keyup'),
  }))
    .actions(() => ({
      save: () => {
        toast.success('Saved successfully');
        saveUrlSnapshot();
      },
    }))
    .subscriptions(({ $keyUp, $keyDown }, { save }) => [
      $keyDown
        .pipe(
          filter((e) => e.metaKey && e.code === 'KeyS'),
          tap((e) => e.preventDefault())
        )
        .subscribe(save),
    ]);
};

export const { ModelProvider: AppProvider, useModel: useApp } = rxModelReact('appModel', appModel);

export type AppModule = ReturnType<typeof useApp>;
