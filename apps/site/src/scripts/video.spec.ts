import { stubBrowser } from './browser-stubs';
import { PLAY_SHARE, playWhenSeen } from './video';

let browser: ReturnType<typeof stubBrowser>;
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  browser = stubBrowser();
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
    browser.seen([{ target: video, isIntersecting: true, intersectionRatio: 0.1 }]);
    expect(calls).toEqual([]);
    browser.seen([{ target: video, isIntersecting: true, intersectionRatio: PLAY_SHARE }]);
    browser.seen([{ target: video, isIntersecting: false, intersectionRatio: 0 }]);
    expect(calls).toEqual(['play', 'pause']);
  });

  it('leaves the poster where motion is reduced or data saved', () => {
    browser.reduced = true;
    expect(playWhenSeen()).toBe(0);
    browser.reduced = false;
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    expect(playWhenSeen()).toBe(0);
    Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
  });

  it('does nothing without a video', () => {
    document.body.innerHTML = '';
    expect(playWhenSeen()).toBe(0);
  });
});
