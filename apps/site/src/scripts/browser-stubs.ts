// The browser of the specs of the moving parts (art, scenes, video), as much of it as jsdom lacks: the animation
// frames asked for (`frames`, run by `step`), the query of reduced motion (`reduced`) and the observers, whose
// callbacks the spec calls (`seen`, `resized`).

type Callback = (entries: object[]) => void;

export const stubBrowser = () => {
  const browser = {
    frames: [] as FrameRequestCallback[],
    reduced: false,
    seen: (() => undefined) as Callback,
    resized: (() => undefined) as Callback,
    step: (time: number) => {
      const pending = browser.frames;
      browser.frames = [];
      for (const callback of pending) callback(time);
    },
  };
  window.requestAnimationFrame = (callback) => browser.frames.push(callback);
  window.cancelAnimationFrame = () => undefined;
  window.matchMedia = ((query: string) => ({
    matches: browser.reduced && query.includes('reduce'),
  })) as never;
  window.ResizeObserver = class {
    constructor(callback: Callback) {
      browser.resized = callback;
    }
    observe() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as never;
  window.IntersectionObserver = class {
    constructor(callback: Callback) {
      browser.seen = callback;
    }
    observe() {
      return undefined;
    }
  } as never;
  return browser;
};
