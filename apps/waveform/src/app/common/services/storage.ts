// localStorage: the browser; sessionStorage: the tab, it survives reloads
type StorageName = 'localStorage' | 'sessionStorage';

// the stored value may be stale or edited by hand, so it is used only when it passes `isValid`;
// reaching the storage itself throws when site data is blocked
export const readStored = <T>(
  storage: StorageName,
  key: string,
  initial: T,
  isValid: (value: unknown) => value is T
): T => {
  try {
    const raw = window[storage].getItem(key);
    if (raw === null) return initial;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : initial;
  } catch {
    return initial;
  }
};

// null removes the key
export const writeStored = (storage: StorageName, key: string, value: unknown) => {
  try {
    if (value === null) window[storage].removeItem(key);
    else window[storage].setItem(key, JSON.stringify(value));
  } catch {
    // storage is unavailable (private mode, full), keep the value in memory only
  }
};

const PROBE_KEY = 'storageProbe';

// the storage keeps what is written (reaching a blocked one throws, writing into a full one)
export const canStore = (storage: StorageName) => {
  try {
    window[storage].setItem(PROBE_KEY, '1');
    window[storage].removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
};
