import { fromEvent, filter, tap } from 'rxjs';
import toast from 'react-hot-toast';
import { rxModel, rxModelReact } from '@waveform/rxjs-react';
import { getSnapshot, setInitSnapshot } from '../plugins/snapshot';

const storageKey = 'Waveform';

const appModel = () => {
  const value = localStorage.getItem(storageKey);
  if (value) setInitSnapshot(value);

  return rxModel(() => ({
    $keyUp: fromEvent<KeyboardEvent>(document, 'keydown'),
  }))
    .actions(() => ({
      save: () => {
        toast.success('Saved successfully')
        localStorage.setItem(storageKey, getSnapshot())
      },
    }))
    .subscriptions(({ $keyUp }, { save }) => [
      $keyUp
        .pipe(
          filter((e) => e.metaKey && e.code === 'KeyS'),
          tap((e) => e.preventDefault())
        )
        .subscribe(save),
    ]);
};

export const { ModelProvider: AppModelProvider } = rxModelReact('appModel', appModel);
