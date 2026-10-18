// LineChart draws only once it has a size, the ResizeObserver stub of test-setup never reports one: this one
// reports width × height for every element it observes, at once. Returns the restore of the stub.
export const withElementSize = (width: number, height: number) => {
  const previous = globalThis.ResizeObserver;
  class SizedObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      const entry = { target, contentRect: { width, height } } as unknown as ResizeObserverEntry;
      this.callback([entry], this as unknown as ResizeObserver);
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  }
  Object.assign(globalThis, { ResizeObserver: SizedObserver });
  return () => Object.assign(globalThis, { ResizeObserver: previous });
};
