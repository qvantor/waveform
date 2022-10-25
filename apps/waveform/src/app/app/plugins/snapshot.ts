import { snapshotPlugin } from '@waveform/rxjs-react';

export const {
  modelPlugin: appSnapshotPlugin,
  getSnapshot,
  loadSnapshot,
  setInitSnapshot,
} = snapshotPlugin();
