import React from 'react';
import { Model, ModelFactory, useRxModel } from './create-rx-module';
import { useNullableContext } from '../hooks';

export const modelProvider = <D extends Record<any, any>, M extends Record<any, any>, A>(
  model: (deps?: D) => ModelFactory<M, A>
) => {
  const Context = React.createContext<Model<M, A> | null>(null);
  const useProvider = () => useNullableContext(Context);
  const Provider = ({ children, ...rest }: { children: React.ReactNode } & D) => {
    // const value = useRxModel(model, rest);
    return <>{children}</>;
  };
  return { Provider, useProvider, Context };
};
