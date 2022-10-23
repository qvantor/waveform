import React from 'react';
import { Model, ModelFactory } from './create-rx-module';
import { useNullableContext } from '../hooks';

const useRxModel = <D, M extends Record<any, any>, A>(
  name: string,
  rxModelFactory: (deps: D) => ModelFactory<M, A>,
  deps: D
): Model<M, A> => {
  const [state, actions, lifecycle] = React.useMemo(() => rxModelFactory(deps).init(name), []);
  React.useEffect(() => {
    return () => {
      lifecycle.stop();
    };
  }, [lifecycle]);
  return [state, actions];
};

export const modelProvider = <
  D extends Record<any, any>, // dependencies
  M extends Record<any, any>, // model
  A // actions
>(
  name: string,
  model: (deps: D) => ModelFactory<M, A>
) => {
  const Context = React.createContext<Model<M, A> | null>(null);
  const useModel = () => useNullableContext(Context);
  const ModelProvider = ({ children, ...rest }: { children: React.ReactNode } & D) => {
    const value = useRxModel(name, model, rest as unknown as D);
    return <Context.Provider value={value}>{children}</Context.Provider>;
  };
  return { ModelProvider, useModel, Context };
};
