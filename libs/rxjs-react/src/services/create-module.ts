import { Subscription } from 'rxjs';

export interface Module<T = void, A = void> {
  context: T;
  actions: A;
  active: boolean;
  destroy: () => Module<T, A>;
}

export interface CreateRxModuleParams<T, A> {
  createContext: () => T;
  subscriptions?: (
    context: T,
    actions: A,
    complexSubscription: (subscription: Subscription) => (subscription: Subscription) => void
  ) => Array<Subscription | Array<Subscription>>;
  actions?: (context: T) => A;
  onDestroy?: (context: T) => void;
}

export const createRxModule = <T, A = unknown>({
  createContext,
  subscriptions,
  actions,
  onDestroy,
}: CreateRxModuleParams<T, A>): Module<T, A> => {
  let active = true;
  const context = createContext();
  const actionsResult = actions?.(context) ?? ({} as A);
  const complexSubscriptionsList = new Map<symbol, Subscription>();
  const complexSubscription = (subscription: Subscription) => {
    const symbol = Symbol();
    complexSubscriptionsList.set(symbol, subscription);
    return (subscription: Subscription) => {
      complexSubscriptionsList.set(symbol, subscription);
    };
  };
  const subscriptionsList = subscriptions?.(context, actionsResult, complexSubscription).flat() ?? [];

  const destroy = () => {
    if (onDestroy) onDestroy(context);
    subscriptionsList.forEach((subscription) => subscription.unsubscribe());
    complexSubscriptionsList.forEach((subscription) => subscription.unsubscribe());
    active = false;
    return { destroy, context, actions: actionsResult, active };
  };

  return { destroy, context, actions: actionsResult, active };
};
