import { installCanvasStub } from './common/test-utils/canvas';

// jsdom has no 2D context: the live charts and the marks draw on a recording stub
installCanvasStub();

// antd (its popups since v6) observes the size of elements: jsdom has no ResizeObserver
class ObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}
Object.assign(globalThis, { ResizeObserver: ObserverStub });
