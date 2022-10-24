import { Subscription } from 'rxjs';
import { Initializers, ModelInternal, ModelFactory, Plugin } from '../types';

// @todo improvements - make a model by types, then initial it with values
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
