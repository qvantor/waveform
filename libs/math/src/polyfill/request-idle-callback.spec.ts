import { cancelIdleCallback, requestIdleCallback } from './request-idle-callback';

describe('requestIdleCallback polyfill', () => {
  const original = {
    requestIdleCallback: window.requestIdleCallback,
    cancelIdleCallback: window.cancelIdleCallback,
  };

  afterEach(() => Object.assign(window, original));

  it('uses native requestIdleCallback when available', () => {
    const request = jest.fn(() => 7);
    const cancel = jest.fn();
    Object.assign(window, { requestIdleCallback: request, cancelIdleCallback: cancel });
    const callback = jest.fn();

    expect(requestIdleCallback(callback)).toBe(7);
    expect(request).toHaveBeenCalledWith(callback);
    cancelIdleCallback(7);
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('falls back to animation frames', () => {
    Object.assign(window, { requestIdleCallback: undefined, cancelIdleCallback: undefined });
    const raf = jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(3);
    const caf = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const callback = jest.fn();

    expect(requestIdleCallback(callback)).toBe(3);
    expect(raf).toHaveBeenCalledWith(callback);
    cancelIdleCallback(3);
    expect(caf).toHaveBeenCalledWith(3);
  });
});
