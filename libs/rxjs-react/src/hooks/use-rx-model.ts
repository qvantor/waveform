import React from 'react';
import { Model, ModelFactory } from '../types';

// function useRxModel(): Model<M, A>;

export const useRxModel = <D, M extends Record<any, unknown>, A, I>(
  name: string,
  rxModelFactory: (deps: D) => ModelFactory<M, A, I>,
  deps: D,
  initial: I
): Model<M, A> => {
  const [state, actions, lifecycle] = React.useMemo(() => rxModelFactory(deps).init(name, initial), []);
  React.useEffect(() => {
    return () => {
      lifecycle.stop();
    };
  }, [lifecycle]);
  return [state, actions];
};
