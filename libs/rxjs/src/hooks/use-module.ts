import React from 'react';

import type { Module } from '../services';

export const useModule = <T, Actions, A extends unknown[]>(
  moduleCreation: (...args: A) => Module<T, Actions>,
  args: A
) => {
  const module = React.useMemo(() => moduleCreation(...args), [...args]);

  React.useEffect(
    () => () => {
      module.destroy();
    },
    [module]
  );

  return module;
};
