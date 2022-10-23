import { BehaviorSubject, mergeWith, Subscription, map } from 'rxjs';

type Plugin<M> = {
  onInit?: (model: M, meta: Meta) => void;
  onStop?: (model: M, meta: Meta) => void;
};

interface Initializers<M, A> {
  actions: Array<(model: M) => A>;
  subscriptions: Array<(model: M) => Subscription | Subscription[]>;
  plugins: Array<Plugin<M>>;
}

type Meta = {
  readonly name: string;
  readonly active: boolean;
};
type ModelLifecycle = {
  meta: Meta;
  stop: () => void;
};
type ModelInternal<M extends Record<any, unknown>, A> = [M, A, ModelLifecycle];
export type Model<M extends Record<any, unknown>, A> = [M, A];

export type ModelFactory<M extends Record<any, unknown>, A> = {
  init: (name: string) => ModelInternal<M, A>;
  actions: <NA>(fn: (model: M) => NA) => ModelFactory<M, A & NA>;
  subscriptions: (fn: (model: M) => Subscription | Subscription[]) => ModelFactory<M, A>;
  plugins: (plugins: Plugin<M> | Array<Plugin<M>>) => ModelFactory<M, A>;
};

// @todo save/load, undo/redo
export const rxModel = <M extends Record<any, unknown>, A extends Record<any, unknown>>(
  state: M,
  initializers: Initializers<M, A> = { actions: [], subscriptions: [], plugins: [] }
): ModelFactory<M, A> => {
  const cloneSelf = <NA>(model: M, opts: Partial<Initializers<M, NA>>): ModelFactory<M, A & NA> => {
    const actions = [...initializers.actions, ...(opts.actions ?? [])] as ((model: M) => A & NA)[];
    const subscriptions = [...initializers.subscriptions, ...(opts.subscriptions ?? [])];
    const plugins = [...initializers.plugins, ...(opts.plugins ?? [])];
    return rxModel(model, { actions, subscriptions, plugins });
  };

  const actions = <NA>(fn: (model: M) => NA) => cloneSelf(state, { actions: [fn] });
  const subscriptions = (fn: (model: M) => Subscription | Subscription[]) =>
    cloneSelf(state, { subscriptions: [fn] });
  const plugins = (plugin: Plugin<M> | Array<Plugin<M>>) =>
    cloneSelf(state, { plugins: Array.isArray(plugin) ? plugin : [plugin] });

  const init = (name: string): ModelInternal<M, A> => {
    const meta = { name, active: true };
    const actions = initializers.actions.reduce((sum, fn) => ({ ...sum, ...fn(state) }), {} as A);
    const subscriptions = initializers.subscriptions.map((fn) => fn(state)).flat();
    initializers.plugins.forEach((plugin) => plugin?.onInit?.(state, meta));

    const stop = () => {
      meta.active = false;
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      initializers.plugins.forEach((plugin) => plugin?.onStop?.(state, meta));
    };
    return [state, actions, { stop, meta }];
  };
  return {
    init,
    actions,
    subscriptions,
    plugins,
  };
};

// custom models
interface Snapshotable<T = unknown> {
  readonly __snapshotable: true;
  getSnapshot: () => unknown;
  setSnapshot: (value: SnapshotValue<T>) => void;
}

const isSnapshotable = (value: unknown): value is Snapshotable =>
  typeof value === 'object' && value !== null && '__snapshotable' in value;

type SnapshotType = 'PrimitiveBS' | 'ArrayBS' | 'ObjectBS';
type SnapshotValue<V> = { _type_: SnapshotType; value: V };

const getSnapshotValue = <T>(type: SnapshotType, value: T): SnapshotValue<T> => ({ _type_: type, value });
const isSnapshotValue = (value: unknown): value is SnapshotValue<unknown> =>
  typeof value === 'object' && value !== null && '_type_' in value;

const snapshotToValue = (value: SnapshotValue<any>) => {
  switch (value._type_) {
    case 'PrimitiveBS':
      return value.value;
    case 'ArrayBS':
      return new ArrayBS(value.value);
    case 'ObjectBS':
      return new ObjectBS(value.value);
  }
};

class PrimitiveBS<T extends string | boolean | number | null | undefined>
  extends BehaviorSubject<T>
  implements Snapshotable<T>
{
  readonly __snapshotable = true as const;
  getSnapshot = (): SnapshotValue<T> => {
    return getSnapshotValue('PrimitiveBS', this.value);
  };
  setSnapshot = (value: SnapshotValue<T>) => {
    this.next(snapshotToValue(value));
  };
}

class ArrayBS<T> extends BehaviorSubject<Array<T>> implements Snapshotable<Array<T>> {
  readonly __snapshotable = true as const;

  getSnapshot = (): SnapshotValue<Array<unknown>> => {
    return getSnapshotValue(
      'ArrayBS',
      this.value.map((value) => (isSnapshotable(value) ? value.getSnapshot() : value))
    );
  };
  setSnapshot = (snap: SnapshotValue<Array<T>>) => {
    this.next(
      snap.value.map((value) => (isSnapshotValue(value) ? snapshotToValue(value) : value)) as Array<T>
    );
  };
}

class ObjectBS<T extends Record<any, unknown>> extends BehaviorSubject<T> implements Snapshotable<T> {
  readonly __snapshotable = true as const;

  getSnapshot = (): SnapshotValue<Record<any, unknown>> => {
    const resultObject: Record<any, unknown> = {};
    for (const key in this.value) {
      const value = this.value[key];
      resultObject[key] = isSnapshotable(value) ? value.getSnapshot() : value;
    }
    return getSnapshotValue('ObjectBS', resultObject);
  };
  setSnapshot = (value: SnapshotValue<T>) => {
    const newValue: Record<any, unknown> = {};
    for (const key in value.value) {
      const valueItem = value.value[key];
      newValue[key] = isSnapshotValue(valueItem) ? snapshotToValue(valueItem) : value.value[key];
    }
    this.next(newValue as T);
  };
}

// snapshoter module
const snapshotPlugin = () => {
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

const snapshot = snapshotPlugin();

// tests
const primitives = {
  null: null,
  undefined: undefined,
  boolean: true,
  string: 'My name is',
  // bigint: BigInt(9007199254740991),
  number: 12,
};

const bs = {
  simpleBs: new PrimitiveBS(0),
  arrayBs: new ArrayBS([1, 2, 3]),
  bsArrayBs: new ArrayBS([new ArrayBS([1, 2, 3]), new ArrayBS([3, 2, 1]), new ArrayBS([1, 2, 3])]),
  bsObjectBs: new ObjectBS(primitives),
};

const [model, actions] = rxModel({
  ...primitives,
  function: () => console.log('ok'),
  array: [1, 2, 3],
  object: {
    string: 'value',
  },
  ...bs,
  bsObjectBs: new ObjectBS({
    ...primitives,
    ...bs,
  }),
})
  .actions(({ arrayBs, bsArrayBs, bsObjectBs }) => ({
    setArrayBs: (value: number[]) => arrayBs.next(value),
    setBsArrayBs: (value: number[]) => {
      bsArrayBs.next([new ArrayBS(value)]);
    },
    setBsObjectBs: (value: number[]) => {
      bsObjectBs.value.bsArrayBs.value[0].next(value);
    },
  }))
  .plugins(snapshot.modelPlugin(['bsObjectBs', 'bsArrayBs', 'arrayBs']))
  .subscriptions(({ bsArrayBs, simpleBs }) => [
    bsArrayBs
      .pipe(
        mergeWith(simpleBs),
        map(() => bsArrayBs.value[simpleBs.value].value)
      )
      .subscribe((value) => console.log(value)),
  ])
  .init('testModule');

console.log(model.bsObjectBs.value.bsArrayBs.value[0].value);
const snap = snapshot.getSnapshot();
console.log(snap);
actions.setArrayBs([9, 9, 9]);
actions.setBsArrayBs([64, 64, 64]);
actions.setBsObjectBs([333, 333, 333]);
console.log(model.bsObjectBs.value.bsArrayBs.value[0].value);

snapshot.loadSnapshot(snap);
console.log(model.bsObjectBs.value.bsArrayBs.value[0].value);
console.log(model.bsArrayBs.value);
