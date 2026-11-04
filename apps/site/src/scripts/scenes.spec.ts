import { stubBrowser } from './browser-stubs';
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

let browser: ReturnType<typeof stubBrowser>;

beforeEach(() => {
  strokes.length = 0;
  browser = stubBrowser();
  HTMLCanvasElement.prototype.getContext = (() => fake()) as never;
  document.body.innerHTML = `
    <canvas data-scene="unison"></canvas>
    <canvas data-scene="effects"></canvas>
    <canvas data-scene="nothing"></canvas>`;
});

describe('animateScenes', () => {
  it('takes the canvases of known scenes', () => {
    expect(animateScenes()).toBe(2);
  });

  it('draws a scene only while it is seen, about FPS times a second', () => {
    animateScenes();
    const [unison, effects] = document.querySelectorAll('canvas');
    browser.resized([{ target: unison }, { target: effects }]);
    // sized off screen: not drawn
    expect(strokes).toHaveLength(0);
    expect(browser.frames).toHaveLength(0);

    browser.seen([{ target: unison, isIntersecting: true }]);
    expect(browser.frames).toHaveLength(1);
    browser.step(100);
    // the 7 voices of the unison
    expect(strokes).toHaveLength(7);
    // not again within a frame of FPS
    browser.step(110);
    expect(strokes).toHaveLength(7);
    browser.step(140);
    expect(strokes).toHaveLength(14);

    browser.seen([{ target: unison, isIntersecting: false }]);
    browser.step(200);
    expect(browser.frames).toHaveLength(0);
  });

  it('draws one still frame where motion is reduced, when the scene is seen', () => {
    browser.reduced = true;
    animateScenes();
    const [unison] = document.querySelectorAll('canvas');
    browser.resized([{ target: unison }]);
    browser.seen([{ target: unison, isIntersecting: true }]);
    browser.step(16);
    expect(strokes).toHaveLength(7);
    browser.step(48);
    browser.step(96);
    expect(strokes).toHaveLength(7);
    expect(browser.frames).toHaveLength(0);
  });

  it('does nothing without a 2D context', () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    expect(animateScenes()).toBe(0);
  });
});
