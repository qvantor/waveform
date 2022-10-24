import { Subscription } from 'rxjs';

export type Plugin<M> = {
  onInit?: (model: M, meta: Meta) => void;
  onStop?: (model: M, meta: Meta) => void;
};

export interface Initializers<M, A> {
  actions: Array<(model: M) => A>;
  subscriptions: Array<(model: M) => Subscription | Subscription[]>;
  plugins: Array<Plugin<M>>;
}

export type Meta = {
  readonly name: string;
  readonly active: boolean;
};
export type ModelLifecycle = {
  meta: Meta;
  stop: () => void;
};
export type ModelInternal<M extends Record<any, unknown>, A> = [M, A, ModelLifecycle];
export type Model<M extends Record<any, unknown>, A> = [M, A];


export type ModelFactory<M extends Record<any, unknown>, A, I> = {
  init: (name: string, initial: I) => ModelInternal<M, A>;
  actions: <NA>(fn: (model: M) => NA) => ModelFactory<M, A & NA, I>;
  subscriptions: (fn: (model: M) => Subscription | Subscription[]) => ModelFactory<M, A, I>;
  plugins: (plugins: Plugin<M> | Array<Plugin<M>>) => ModelFactory<M, A, I>;
};
