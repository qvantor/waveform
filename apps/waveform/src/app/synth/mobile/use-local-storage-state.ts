import React from 'react';
import { readStored, writeStored } from '../../common/services';

export const useLocalStorageState = <T>(key: string, initial: T, isValid: (value: unknown) => value is T) => {
  const [value, setValue] = React.useState<T>(() => readStored('localStorage', key, initial, isValid));
  React.useEffect(() => writeStored('localStorage', key, value), [key, value]);
  return [value, setValue] as const;
};
