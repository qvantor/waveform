import { animateArt } from './art';

// the markup of Hero.astro: the still drawing and the canvas over it
const scene = () => {
  document.body.innerHTML = `<div data-art><svg></svg><canvas hidden></canvas></div>`;
  const canvas = document.querySelector('canvas') as HTMLCanvasElement;
  const still = document.querySelector('svg') as SVGSVGElement;
  return { canvas, still };
};

const context = () => {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (..._args: unknown[]) =>
      calls.push(name);
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

let frames: FrameRequestCallback[] = [];
let visibility: (entries: { isIntersecting: boolean }[]) => void = () => undefined;
let reduced = false;

beforeEach(() => {
  frames = [];
  reduced = false;
  window.requestAnimationFrame = (callback) => frames.push(callback);
  window.cancelAnimationFrame = () => undefined;
  window.matchMedia = ((query: string) => ({ matches: reduced && query.includes('reduce') })) as never;
  window.ResizeObserver = class {
    observe() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as never;
  window.IntersectionObserver = class {
    constructor(callback: typeof visibility) {
      visibility = callback;
    }
    observe() {
      return undefined;
    }
  } as never;
});

const step = (time: number) => {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(time);
};

describe('animateArt', () => {
  it('draws on the canvas while the section is on screen, then hides the still drawing', () => {
    const { canvas, still } = scene();
    const { calls, context: fake } = context();
    canvas.getContext = (() => fake) as never;
    expect(animateArt()).toBe(true);
    expect(frames).toHaveLength(0);

    visibility([{ isIntersecting: true }]);
    step(16);
    expect(calls).toContain('stroke');
    expect(calls.filter((call) => call === 'stroke')).toHaveLength(22);
    expect(canvas.hidden).toBe(false);
    expect(still.style.visibility).toBe('hidden');
    // the next frame is asked for
    expect(frames).toHaveLength(1);
  });

  it('stops once the section leaves the screen', () => {
    const { canvas } = scene();
    canvas.getContext = (() => context().context) as never;
    animateArt();
    visibility([{ isIntersecting: true }]);
    step(16);
    visibility([{ isIntersecting: false }]);
    step(32);
    expect(frames).toHaveLength(0);
  });

  it('leaves the still drawing where motion is reduced or there is no 2D context', () => {
    const { canvas, still } = scene();
    reduced = true;
    expect(animateArt()).toBe(false);
    reduced = false;
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
