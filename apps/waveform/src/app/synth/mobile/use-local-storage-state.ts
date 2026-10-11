import React from 'react';

const read = <T>(key: string, initial: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
};

export const useLocalStorageState = <T>(key: string, initial: T) => {
  const [value, setValue] = React.useState<T>(() => read(key, initial));
  React.useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage is unavailable (private mode), keep the value in memory only
    }
  }, [key, value]);
  return [value, setValue] as const;
};
