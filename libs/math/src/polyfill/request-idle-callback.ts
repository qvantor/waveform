export const requestIdleCallback = (callback: () => void) => {
  return window.requestIdleCallback
    ? window.requestIdleCallback(callback)
    : window.requestAnimationFrame(callback);
};

export const cancelIdleCallback = (handle: number) => {
  window.cancelIdleCallback ? window.cancelIdleCallback(handle) : window.cancelAnimationFrame(handle);
};
