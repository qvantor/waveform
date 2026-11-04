import { animateArt } from './art';
import { stubBrowser } from './browser-stubs';

// the markup of Hero.astro: the still drawing and the canvas over it
const scene = () => {
  document.body.innerHTML = `<div data-art><svg></svg><canvas hidden></canvas></div>`;
  const canvas = document.querySelector('canvas') as HTMLCanvasElement;
  const still = document.querySelector('svg') as SVGSVGElement;
  return { canvas, still };
};

const context = () => {
  const calls: string[] = [];
  const record = (name: string) => () => calls.push(name);
  return {
    calls,
    context: {
      clearRect: record('clearRect'),
      beginPath: record('beginPath'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      stroke: record('stroke'),
      fill: record('fill'),
      save: record('save'),
      restore: record('restore'),
      setTransform: record('setTransform'),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
    },
  };
};

let browser: ReturnType<typeof stubBrowser>;

beforeEach(() => {
  browser = stubBrowser();
});

describe('animateArt', () => {
  it('draws on the canvas while the section is on screen, then hides the still drawing', () => {
    const { canvas, still } = scene();
    const { calls, context: fake } = context();
    canvas.getContext = (() => fake) as never;
    expect(animateArt()).toBe(true);
    expect(browser.frames).toHaveLength(0);

    browser.seen([{ isIntersecting: true }]);
    browser.step(16);
    expect(calls).toContain('stroke');
    expect(calls.filter((call) => call === 'stroke')).toHaveLength(22);
    expect(canvas.hidden).toBe(false);
    expect(still.style.visibility).toBe('hidden');
    // the next frame is asked for
    expect(browser.frames).toHaveLength(1);
  });

  it('stops once the section leaves the screen', () => {
    const { canvas } = scene();
    canvas.getContext = (() => context().context) as never;
    animateArt();
    browser.seen([{ isIntersecting: true }]);
    browser.step(16);
    browser.seen([{ isIntersecting: false }]);
    browser.step(32);
    expect(browser.frames).toHaveLength(0);
  });

  it('leaves the still drawing where motion is reduced or there is no 2D context', () => {
    const { canvas, still } = scene();
    browser.reduced = true;
    expect(animateArt()).toBe(false);
    browser.reduced = false;
    canvas.getContext = (() => null) as never;
    expect(animateArt()).toBe(false);
    expect(canvas.hidden).toBe(true);
    expect(still.style.visibility).toBe('');
  });

  it('does nothing without the drawing', () => {
    document.body.innerHTML = '';
    expect(animateArt()).toBe(false);
  });
});
