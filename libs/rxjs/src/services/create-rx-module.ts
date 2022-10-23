import React from 'react';
import { Subscription } from 'rxjs';

interface Initializers<M, A> {
  actions: Array<(model: M) => A>;
  subscriptions: Array<(model: M) => Subscription | Subscription[]>;
}

type ModelLifecycle = {
  stop: () => void;
};
type ModelInternal<M extends Record<any, any>, A> = [M, A, ModelLifecycle];
export type Model<M extends Record<any, any>, A> = [M, A];

export type ModelFactory<M extends Record<any, any>, A> = {
  init: () => ModelInternal<M, A>;
  actions: <NA>(fn: (model: M) => NA) => ModelFactory<M, A & NA>;
  subscriptions: (fn: (model: M) => Subscription | Subscription[]) => ModelFactory<M, A>;
};
// const snapshotModule = () => {
//   const _addModel = () => {};
//   const getSnapshot = (): string => {};
//   const loadSnapshot = (shapshot: string): void => {};
//   return { _addModel, getSnapshot, loadSnapshot };
// };

// @todo save/load, undo/redo
export const rxModel = <M extends Record<any, any>, A extends Record<any, any>>(
  state: M,
  initializers: Initializers<M, A> = { actions: [], subscriptions: [] }
): ModelFactory<M, A> => {
  const cloneSelf = <NA>(model: M, opts: Initializers<M, NA>): ModelFactory<M, A & NA> => {
    const actions = [...initializers.actions, ...opts.actions] as ((model: M) => A & NA)[];
    const subscriptions = [...initializers.subscriptions, ...opts.subscriptions];
    return rxModel(model, { actions, subscriptions });
  };

  const actions = <NA>(fn: (model: M) => NA) => cloneSelf(state, { actions: [fn], subscriptions: [] });
  const subscriptions = (fn: (model: M) => Subscription | Subscription[]) => {
    return cloneSelf(state, { actions: [], subscriptions: [fn] });
  };

  const init = (): ModelInternal<M, A> => {
    console.log('init');
    const actions = initializers.actions.reduce((sum, fn) => ({ ...sum, ...fn(state) }), {} as A);
    const subscriptions = initializers.subscriptions.map((fn) => fn(state)).flat();
    const stop = () => {
      subscriptions.forEach((subscription) => subscription.unsubscribe());
    };
    return [state, actions, { stop }];
  };
  return {
    init,
    actions,
    subscriptions,
  };
};

export const useRxModel = <D, M extends Record<any, any>, A>(
  rxModelFactory: (deps: D) => ModelFactory<M, A>,
  deps: D
): Model<M, A> => {
  const [state, actions, lifecycle] = React.useMemo(() => rxModelFactory(deps).init(), []);
  React.useEffect(() => {
    return () => {
      lifecycle.stop();
    };
  }, []);
  return [state, actions];
};
