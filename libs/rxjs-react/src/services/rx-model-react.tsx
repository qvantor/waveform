import React from 'react';
import { ModelFactory, Model } from '../types';
import { useNullableContext, useRxModel } from '../hooks';

export const rxModelReact = <
  D extends Record<any, any>, // dependencies
  M extends Record<any, any>, // model
  A, // actions
  I = undefined // initial values
>(
  name: string,
  model: (deps: D) => ModelFactory<M, A, I>
) => {
  const Context = React.createContext<Model<M, A> | null>(null);
  const useModel = () => useNullableContext(Context);
  const ModelProvider = ({ children, initial, ...rest }: { children: React.ReactNode; initial: I } & D) => {
    const value = useRxModel(name, model, rest as unknown as D, initial);
    return <Context.Provider value={value}>{children}</Context.Provider>;
  };
  return { ModelProvider, useModel, Context };
};
