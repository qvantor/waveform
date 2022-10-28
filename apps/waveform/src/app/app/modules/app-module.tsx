import { fromEvent, filter, tap } from 'rxjs';
import toast from 'react-hot-toast';
import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { getSnapshot, setInitSnapshot } from '../plugins/snapshot';

const storageKey = 'Waveform';

const appModel = () => {
  const value = localStorage.getItem(storageKey);
  if (value) setInitSnapshot(value);

  return rxModel(() => ({
    $keyDown: fromEvent<KeyboardEvent>(document, 'keydown'),
    $keyUp: fromEvent<KeyboardEvent>(document, 'keyup'),
  }))
    .actions(() => ({
      save: () => {
        toast.success('Saved successfully');
        localStorage.setItem(storageKey, getSnapshot());
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

export type AppModule = ReturnType<typeof useApp>
