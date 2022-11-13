import React from 'react';

export const useNullableContext = <T>(context: React.Context<T | null>, name?: string): T => {
  const notNullContext = React.useContext(context);
  if (notNullContext === null)
    throw new Error(`Do not use ${name ?? 'useNullableContext'} outside of it Provider`);
  return notNullContext;
};
