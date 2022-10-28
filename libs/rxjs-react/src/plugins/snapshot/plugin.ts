import { isRecord } from '../../utils';
import { isSnapshotable, isSnapshotValue } from './services';
import { Plugin } from '../../types';

type ModelForSnapshot = { model: Record<string | number, unknown>; keys: Array<string | number> };

export const snapshotPlugin = () => {
  let initSnapshot: Record<string | number, unknown> | null = null;

  const setInitSnapshot = (snapshot?: string) => {
    if (!snapshot) {
      initSnapshot = null;
      return;
    }
    const data = JSON.parse(snapshot);
    if (!isRecord(data)) return;
    initSnapshot = data;
  };

  const setSnapshotToModel = (snapshot: unknown, model?: ModelForSnapshot['model']) => {
    if (!isRecord(snapshot) || !model) return;

    for (const key in snapshot) {
      const modelValue = model[key];
      const snap = snapshot[key];
      if (isSnapshotable(modelValue) && isSnapshotValue(snap)) {
        modelValue.setSnapshot(snap);
      }
    }
  };

  const modelForSnap = new Map<string, ModelForSnapshot>();
  const modelPlugin = <M extends Record<string | number, unknown>>(keys?: Array<keyof M>): Plugin<M> => ({
    onInit: (model, meta) => {
      modelForSnap.set(meta.name, { model, keys: keys ? (keys as (string | number)[]) : Object.keys(model) });
      if (initSnapshot && Object.keys(initSnapshot).includes(meta.name)) {
        const value = initSnapshot[meta.name];
        setSnapshotToModel(value, model);
      }
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
    if (!isRecord(data)) return;

    for (const name in data) {
      const modelItem = modelForSnap.get(name);
      const modelSnapshot = data[name];
      setSnapshotToModel(modelSnapshot, modelItem?.model);
    }
  };
  return { modelPlugin, getSnapshot, loadSnapshot, setInitSnapshot };
};
