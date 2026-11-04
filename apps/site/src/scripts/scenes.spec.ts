import { animateScenes } from './scenes';

const strokes: number[] = [];
const fake = () => ({
  clearRect: () => undefined,
  beginPath: () => undefined,
  moveTo: () => undefined,
  lineTo: () => undefined,
  arc: () => undefined,
  fill: () => undefined,
  stroke: () => strokes.push(1),
  setTransform: () => undefined,
  setLineDash: () => undefined,
});

let frames: FrameRequestCallback[] = [];
let seen: (entries: { target: Element; isIntersecting: boolean }[]) => void = () => undefined;
let resized: (entries: { target: Element }[]) => void = () => undefined;
let reduced = false;

beforeEach(() => {
  strokes.length = 0;
  frames = [];
  reduced = false;
  window.requestAnimationFrame = (callback) => frames.push(callback);
  window.matchMedia = ((query: string) => ({ matches: reduced && query.includes('reduce') })) as never;
  window.ResizeObserver = class {
    constructor(callback: typeof resized) {
      resized = callback;
    }
    observe() {
      return undefined;
    }
  } as never;
  window.IntersectionObserver = class {
    constructor(callback: typeof seen) {
      seen = callback;
    }
    observe() {
      return undefined;
    }
  } as never;
  HTMLCanvasElement.prototype.getContext = (() => fake()) as never;
  document.body.innerHTML = `
    <canvas data-scene="unison"></canvas>
    <canvas data-scene="effects"></canvas>
    <canvas data-scene="nothing"></canvas>`;
});

const step = (time: number) => {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(time);
};

describe('animateScenes', () => {
  it('takes the canvases of known scenes', () => {
    expect(animateScenes()).toBe(2);
  });

  it('draws a scene only while it is seen, about FPS times a second', () => {
    animateScenes();
    const [unison, effects] = document.querySelectorAll('canvas');
    resized([{ target: unison }, { target: effects }]);
    // sized off screen: not drawn
    expect(strokes).toHaveLength(0);
    expect(frames).toHaveLength(0);

    seen([{ target: unison, isIntersecting: true }]);
    expect(frames).toHaveLength(1);
    step(100);
    // the 7 voices of the unison
    expect(strokes).toHaveLength(7);
    // not again within a frame of FPS
    step(110);
    expect(strokes).toHaveLength(7);
    step(140);
    expect(strokes).toHaveLength(14);

    seen([{ target: unison, isIntersecting: false }]);
    step(200);
    expect(frames).toHaveLength(0);
  });

  it('draws one still frame where motion is reduced, when the scene is seen', () => {
    reduced = true;
    animateScenes();
    const [unison] = document.querySelectorAll('canvas');
    resized([{ target: unison }]);
    seen([{ target: unison, isIntersecting: true }]);
    step(16);
    expect(strokes).toHaveLength(7);
    step(48);
    step(96);
    expect(strokes).toHaveLength(7);
    expect(frames).toHaveLength(0);
  });

  it('does nothing without a 2D context', () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    expect(animateScenes()).toBe(0);
  });
});
