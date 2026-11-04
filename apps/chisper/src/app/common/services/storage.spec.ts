import { blockStorage, fillStorage } from '../../../test-utils/storage';
import { canStore, readStored, writeStored } from './storage';

const isNumber = (value: unknown): value is number => typeof value === 'number';

describe('storage', () => {
  it.each(['localStorage', 'sessionStorage'] as const)('writes and reads a value of %s', (storage) => {
    writeStored(storage, 'key', 5);
    expect(window[storage].getItem('key')).toBe('5');
    expect(readStored(storage, 'key', 1, isNumber)).toBe(5);
  });

  it('null removes the key', () => {
    sessionStorage.setItem('key', '5');
    writeStored('sessionStorage', 'key', null);
    expect(sessionStorage.getItem('key')).toBeNull();
  });

  it.each([
    ['nothing stored', null],
    ['a value that is not valid', '"text"'],
    ['broken json', 'broken'],
  ])('reads the initial value for %s', (_, raw) => {
    if (raw !== null) sessionStorage.setItem('key', raw);
    expect(readStored('sessionStorage', 'key', 1, isNumber)).toBe(1);
  });

  it('works without the storage: blocked site data throws on reaching it', () => {
    expect(canStore('sessionStorage')).toBe(true);
    blockStorage('sessionStorage');
    expect(() => writeStored('sessionStorage', 'key', 5)).not.toThrow();
    expect(readStored('sessionStorage', 'key', 1, isNumber)).toBe(1);
    expect(canStore('sessionStorage')).toBe(false);
  });

  it('cannot store in a full storage', () => {
    fillStorage();
    expect(canStore('localStorage')).toBe(false);
  });
});
