import { PLAY_SHARE, playWhenSeen } from './video';

type Entry = { target: Element; isIntersecting: boolean; intersectionRatio: number };
let seen: (entries: Entry[]) => void = () => undefined;
let reduced = false;
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  reduced = false;
  window.matchMedia = ((query: string) => ({ matches: reduced && query.includes('reduce') })) as never;
  window.IntersectionObserver = class {
    constructor(callback: typeof seen) {
      seen = callback;
    }
    observe() {
      return undefined;
    }
  } as never;
  HTMLMediaElement.prototype.play = function () {
    calls.push('play');
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {
    calls.push('pause');
  };
  document.body.innerHTML = `<video data-autoplay muted loop playsinline preload="none"></video>`;
});

describe('playWhenSeen', () => {
  it('plays the video once enough of it is on screen and pauses it off it', () => {
    expect(playWhenSeen()).toBe(1);
    expect(calls).toEqual([]);
    const video = document.querySelector('video') as HTMLVideoElement;
    // its edge under the first section: not yet
    seen([{ target: video, isIntersecting: true, intersectionRatio: 0.1 }]);
    expect(calls).toEqual([]);
    seen([{ target: video, isIntersecting: true, intersectionRatio: PLAY_SHARE }]);
    seen([{ target: video, isIntersecting: false, intersectionRatio: 0 }]);
    expect(calls).toEqual(['play', 'pause']);
  });

  it('leaves the poster where motion is reduced or data saved', () => {
    reduced = true;
    expect(playWhenSeen()).toBe(0);
    reduced = false;
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    expect(playWhenSeen()).toBe(0);
    Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
  });

  it('does nothing without a video', () => {
    document.body.innerHTML = '';
    expect(playWhenSeen()).toBe(0);
  });
});
