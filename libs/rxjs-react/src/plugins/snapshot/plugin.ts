import { isSnapshotable, isSnapshotValue } from './services';
import { Plugin } from '../../types';

export const snapshotPlugin = () => {
  const modelForSnap = new Map<
    string,
    { model: Record<string | number, unknown>; keys: Array<string | number> }
  >();
  const modelPlugin = <M extends Record<string | number, unknown>>(keys?: Array<keyof M>): Plugin<M> => ({
    onInit: (model, meta) => {
      modelForSnap.set(meta.name, { model, keys: keys ? (keys as (string | number)[]) : Object.keys(model) });
    },
    onStop: (model, meta) => {
      modelForSnap.delete(meta.name);
    },
  });
  const getSnapshot = (): string => {
    const primitiveStore: Record<string | number, unknown> = {};
    for (const [name, { model, keys }] of modelForSnap) {
      const modelStore: Record<string | number, unknown> = {};
      for (const key of keys) {
        const value = model[key];
        if (isSnapshotable(value)) {
          modelStore[key] = value.getSnapshot();
        }
      }
      primitiveStore[name] = modelStore;
    }
    return JSON.stringify(primitiveStore);
  };
  const loadSnapshot = (snapshot: string): void => {
    const data = JSON.parse(snapshot);
    if (typeof data !== 'object') return;
    for (const name in data) {
      const modelItem = modelForSnap.get(name);
      if (!modelItem) return;
      for (const key in data[name]) {
        const modelValue = modelItem.model[key];
        const snap = data[name][key];
        if (isSnapshotable(modelValue) && isSnapshotValue(snap)) {
          modelValue.setSnapshot(snap);
        }
      }
    }
  };
  return { modelPlugin, getSnapshot, loadSnapshot };
};
