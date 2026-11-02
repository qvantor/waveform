export const requestIdleCallback = (callback: () => void) => {
  return window.requestIdleCallback
    ? window.requestIdleCallback(callback)
    : window.requestAnimationFrame(callback);
};

export const cancelIdleCallback = (handle: number) => {
  if (window.cancelIdleCallback) window.cancelIdleCallback(handle);
  else window.cancelAnimationFrame(handle);
};
