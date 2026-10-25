// jsdom has no layout (the stub of the app's test-setup never reports a size): an observer that reports width ×
// height for every element it observes, at once (charts draw, the wheel turns only once they have a size). The specs
// of the app take it as `@waveform/ui-kit/test-utils`. Returns the restore of the one before
export const withElementSize = (width: number, height: number) => {
  const previous = globalThis.ResizeObserver;
  class SizedObserver {
    constructor(private callback: ResizeObserverCallback) {}
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
