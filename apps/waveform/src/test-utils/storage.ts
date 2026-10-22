const spies: jest.SpyInstance[] = [];

// site data blocked: reaching the storage throws; test-setup restores it after each test, before it clears them
export const blockStorage = (storage: 'localStorage' | 'sessionStorage') =>
  spies.push(
    jest.spyOn(window, storage, 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    })
  );

// a full storage: writing into it throws (both of them)
export const fillStorage = () =>
  spies.push(
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    })
  );

export const restoreStorage = () => spies.splice(0).forEach((spy) => spy.mockRestore());
