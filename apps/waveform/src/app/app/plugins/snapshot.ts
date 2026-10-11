import { searchParamsSnapshotPlugin } from '@waveform/rxjs-react';

export const {
  plugin: urlSnapshotPlugin,
  getSnapshot,
  applySnapshot,
  $changes: $snapshotChanges,
} = searchParamsSnapshotPlugin();
