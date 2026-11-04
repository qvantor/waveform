import { searchParamsSnapshotPlugin } from '@chisper/rxjs-react';

export const {
  plugin: urlSnapshotPlugin,
  getSnapshot,
  applySnapshot,
  $changes: $snapshotChanges,
} = searchParamsSnapshotPlugin();
