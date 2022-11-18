import { Subscription } from 'rxjs';
import { Initializers, ModelInternal, ModelFactory, Plugin } from '../types';

type State<M, I = undefined> = M | ((initial: I) => M);

// @todo improvements - make a model by types, then initial it with values
export const rxModel = <
  M extends Record<string | number, unknown>,
  A extends Record<string | number, unknown>,
  I
>(
  model: State<M, I>,
  initializers: Initializers<M, A> = { actions: [], subscriptions: [], plugins: [], destroy: [] }
): ModelFactory<M, A, I> => {
  const cloneSelf = <NA>(
    model: State<M, I>,
    opts: Partial<Initializers<M, NA>>
  ): ModelFactory<M, A & NA, I> => {
    const actions = [...initializers.actions, ...(opts.actions ?? [])] as ((model: M) => A & NA)[];
    const subscriptions = [...initializers.subscriptions, ...(opts.subscriptions ?? [])];
    const plugins = [...initializers.plugins, ...(opts.plugins ?? [])];
    const destroy = [...initializers.destroy, ...(opts.destroy ?? [])];
    return rxModel(model, { actions, subscriptions, plugins, destroy });
  };

  const actions = <NA>(fn: (model: M) => NA) => cloneSelf(model, { actions: [fn] });
  const subscriptions = (fn: (model: M, actions: A) => Subscription | Subscription[]) =>
    cloneSelf(model, { subscriptions: [fn] });
  const plugins = (plugin: Plugin<M> | Array<Plugin<M>>) =>
    cloneSelf(model, { plugins: Array.isArray(plugin) ? plugin : [plugin] });
  const destroy = (fn: (model: M) => void) => cloneSelf(model, { destroy: [fn] });

  const init = (name: string, initial: I): ModelInternal<M, A> => {
    const meta = { name, active: true };
    const modelValue = typeof model === 'function' ? model(initial) : model;
    const actions = initializers.actions.reduce((sum, fn) => ({ ...sum, ...fn(modelValue) }), {} as A);
    const subscriptions = initializers.subscriptions.map((fn) => fn(modelValue, actions)).flat();
    initializers.plugins.forEach((plugin) => plugin?.onInit?.(modelValue, meta));

    const stop = () => {
      meta.active = false;
      initializers.destroy.forEach(fn => fn(modelValue))
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      initializers.plugins.forEach((plugin) => plugin?.onStop?.(modelValue, meta));
    };
    return [modelValue, actions, { stop, meta }];
  };
  return {
    init,
    actions,
    subscriptions,
    plugins,
    destroy,
  };
};
