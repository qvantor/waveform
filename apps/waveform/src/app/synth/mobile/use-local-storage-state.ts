import React from 'react';

// the stored value may be stale or edited by hand, so it is used only when it passes `isValid`
const read = <T>(key: string, initial: T, isValid: (value: unknown) => value is T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return initial;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : initial;
  } catch {
    return initial;
  }
};

export const useLocalStorageState = <T>(key: string, initial: T, isValid: (value: unknown) => value is T) => {
  const [value, setValue] = React.useState<T>(() => read(key, initial, isValid));
  React.useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage is unavailable (private mode), keep the value in memory only
    }
  }, [key, value]);
  return [value, setValue] as const;
};
