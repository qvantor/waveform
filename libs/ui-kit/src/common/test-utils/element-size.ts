// jsdom has no layout (the stub of the app's test-setup never reports a size): an observer that reports width ×
// height for every element it observes, at once (charts draw, the wheel turns only once they have a size), and a new
// size to every element observed on `resize` (a new place). `restore` puts back the observer before
export const sizedElements = (width: number, height: number) => {
  const previous = globalThis.ResizeObserver;
  let size = { width, height };
  const observers = new Set<SizedObserver>();
  class SizedObserver {
    readonly targets = new Set<Element>();
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.targets.add(target);
      observers.add(this);
      this.report([target]);
    }
    report(targets: Iterable<Element>) {
      const entries = Array.from(targets, (target) => ({ target, contentRect: { ...size } }));
      if (entries.length)
        this.callback(entries as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }
  }
  Object.assign(globalThis, { ResizeObserver: SizedObserver });
  return {
    resize: (nextWidth: number, nextHeight: number) => {
      size = { width: nextWidth, height: nextHeight };
      observers.forEach((observer) => observer.report(observer.targets));
    },
    restore: () => Object.assign(globalThis, { ResizeObserver: previous }),
  };
};

// every element observed width × height. The specs of the app take it as `@chisper/ui-kit/test-utils`. Returns the
// restore of the observer before
export const withElementSize = (width: number, height: number) => sizedElements(width, height).restore;
