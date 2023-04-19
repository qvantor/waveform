import { Plugin } from '../../types';

type Snap = Record<string, string | number | boolean | string[]>;

interface PluginConfig<M, S> {
  modelToSnap: (model: M) => S;
  applySnap: (snap: Partial<S>, model: M) => void;
  prefix?: string;
}

type ModelForSnap<M, S> = {
  model: Record<string | number, M>;
  modelToSnap: (model: M) => S;
  applySnap: (snap: Partial<S>, model: M) => void;
};

const searchToSnapshots = () => {
  const initialSnap = new URLSearchParams(window.location.search);
  const obj: Record<string, Snap> = {};
  initialSnap.forEach((value, key) => {
    const [k, v] = key.split('-');
    if (!k || !v) return;
    obj[k] = {
      ...obj[k],
      [v]: JSON.parse(value),
    };
  });
  return obj;
};

const snapToUrlKey = (name: string, key: string) => `${name}-${key}`;

export const searchParamsSnapshotPlugin = () => {
  const modelForSnap = new Map<string, ModelForSnap<any, any>>();
  const snapshots = searchToSnapshots();

  const saveUrlSnapshot = () => {
    const searchParams = new URLSearchParams();
    for (const [name, { model, modelToSnap }] of modelForSnap) {
      const snapshot = modelToSnap(model) as Record<string, string | number | boolean | string[]>;
      for (const [key, value] of Object.entries(snapshot)) {
        const urlKey = snapToUrlKey(name, key);
        if (searchParams.has(urlKey))
          console.error(`key:${urlKey} exists, change key:${key} in modelToSnap(${name}) function`);
        searchParams.set(urlKey, JSON.stringify(value));
      }
    }
    window.history.replaceState(null, '', '?' + searchParams.toString());
  };
  return {
    saveUrlSnapshot,
    plugin: <M extends Record<string | number, unknown>, S extends Snap>({
      modelToSnap,
      applySnap,
      prefix,
    }: PluginConfig<M, S>): Plugin<M> => {
      return {
        onInit: (model, { name }) => {
          const snapName = prefix ?? name;
          modelForSnap.set(snapName, { model, modelToSnap, applySnap });
          const value = snapshots[snapName] as S;
          if (!value) return;
          applySnap(value, model);
        },
      };
    },
  };
};
