import { merge, skip, Subject, Subscription, BehaviorSubject, map, distinctUntilChanged } from 'rxjs';
import { Plugin } from '../../types';
import { isSnapshotable } from '../snapshot';

// values are JSON: in the url every model key is a separate search param with a JSON value
type SnapValue = string | number | boolean | string[] | { [key: string]: SnapValue };
type Snap = Record<string, SnapValue>;

interface PluginConfig<M, S> {
  modelToSnap: (model: M) => S;
  applySnap: (snap: Partial<S>, model: M) => void;
  prefix?: string;
}

type ModelForSnap<M, S> = {
  model: Record<string | number, M>;
  modelToSnap: (model: M) => S;
  applySnap: (snap: Partial<S>, model: M) => void;
  subscription: Subscription;
};

const searchToSnapshots = () => {
  const initialSnap = new URLSearchParams(window.location.search);
  const obj: Record<string, Snap> = {};
  initialSnap.forEach((value, key) => {
    const [k, v] = key.split('-');
    if (!k || !v) return;
    try {
      obj[k] = {
        ...obj[k],
        [v]: JSON.parse(value),
      };
    } catch (e) {
      console.error(`can't parse search param ${key}`);
    }
  });
  return obj;
};

const isSnapshotableBS = (value: unknown): value is BehaviorSubject<unknown> =>
  value instanceof BehaviorSubject && isSnapshotable(value);

export const searchParamsSnapshotPlugin = () => {
  const modelForSnap = new Map<string, ModelForSnap<any, any>>();
  const snapshots = searchToSnapshots();
  const $changes = new Subject<string>();

  const getSnapshot = () => {
    const result: Record<string, Snap> = {};
    for (const [name, { model, modelToSnap }] of modelForSnap) result[name] = modelToSnap(model);
    return result;
  };

  const applySnapshot = (snapshot: Record<string, Snap>) => {
    for (const [name, { model, applySnap }] of modelForSnap) applySnap(snapshot[name] ?? {}, model);
  };

  return {
    getSnapshot,
    applySnapshot,
    $changes: $changes.asObservable(),
    plugin: <M extends Record<string | number, unknown>, S extends Snap>({
      modelToSnap,
      applySnap,
      prefix,
    }: PluginConfig<M, S>): Plugin<M> => {
      return {
        onInit: (model, { name }) => {
          const snapName = prefix ?? name;
          // emits only when the persisted state changes, not on every snapshotable subject
          const subscription = merge(...Object.values(model).filter(isSnapshotableBS))
            .pipe(
              map(() => JSON.stringify(modelToSnap(model))),
              distinctUntilChanged(),
              skip(1)
            )
            .subscribe(() => $changes.next(snapName));
          modelForSnap.set(snapName, { model, modelToSnap, applySnap, subscription });
          const value = snapshots[snapName] as S;
          if (!value) return;
          applySnap(value, model);
        },
        onStop: (model, { name }) => {
          const snapName = prefix ?? name;
          const entry = modelForSnap.get(snapName);
          if (entry?.model !== model) return;
          entry.subscription.unsubscribe();
          modelForSnap.delete(snapName);
        },
      };
    },
  };
};
