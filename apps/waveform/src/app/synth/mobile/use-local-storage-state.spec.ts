import { act, renderHook } from '@testing-library/react';
import { useLocalStorageState } from './use-local-storage-state';

const isNumber = (value: unknown): value is number => typeof value === 'number';

afterEach(() => jest.restoreAllMocks());

describe('useLocalStorageState', () => {
  it('uses the initial value and persists it', () => {
    const { result } = renderHook(() => useLocalStorageState('key', 1, isNumber));
    expect(result.current[0]).toBe(1);
    expect(localStorage.getItem('key')).toBe('1');
  });

  it('reads a valid stored value and writes updates', () => {
    localStorage.setItem('key', '5');
    const { result } = renderHook(() => useLocalStorageState('key', 1, isNumber));
    expect(result.current[0]).toBe(5);

    act(() => result.current[1](7));
    expect(result.current[0]).toBe(7);
    expect(localStorage.getItem('key')).toBe('7');
  });

  it.each(['"text"', 'broken json'])('falls back to the initial value for %s', (raw) => {
    localStorage.setItem('key', raw);
    const { result } = renderHook(() => useLocalStorageState('key', 1, isNumber));
    expect(result.current[0]).toBe(1);
  });

  it('keeps working in memory when storage throws', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { result } = renderHook(() => useLocalStorageState('key', 1, isNumber));
    act(() => result.current[1](2));
    expect(result.current[0]).toBe(2);
  });
});
