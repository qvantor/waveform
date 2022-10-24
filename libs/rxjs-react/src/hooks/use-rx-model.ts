import React from 'react';
import { Model, ModelFactory } from '../types';

export const useRxModel = <D, M extends Record<any, unknown>, A>(
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
