import { SEEK_STEP, initPlayers } from './player';

// the markup of DemoCard.astro, as much of it as the players read
const card = (slug: string, duration: number) => `
  <article data-player data-duration="${duration}">
    <button type="button" data-play aria-pressed="false" aria-label="Play ${slug}"></button>
    <div data-wave data-span="200" role="slider" tabindex="0" aria-label="Position in ${slug}">
      <svg><clipPath><rect data-progress width="0"></rect></clipPath></svg>
    </div>
    <audio preload="none" src="/demos/${slug}.mp3"></audio>
  </article>`;

// jsdom has no playback: play and pause set the state and fire their events as a browser does
const playing = new WeakSet<HTMLMediaElement>();

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return !playing.has(this);
    },
  });
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    if (!playing.has(this)) {
      playing.add(this);
      this.dispatchEvent(new Event('play'));
    }
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
    if (playing.delete(this)) this.dispatchEvent(new Event('pause'));
  };
});

const setup = () => {
  document.body.innerHTML = card('acid-bass', 8.5) + card('theremin', 17.3);
  initPlayers();
  const [first, second] = [...document.querySelectorAll<HTMLElement>('[data-player]')].map((root) => ({
    root,
    audio: root.querySelector('audio') as HTMLAudioElement,
    play: root.querySelector('[data-play]') as HTMLButtonElement,
    wave: root.querySelector('[data-wave]') as HTMLElement,
    progress: root.querySelector('[data-progress]') as SVGRectElement,
  }));
  return { first, second };
};

const at = (audio: HTMLAudioElement, time: number) => {
  audio.currentTime = time;
  audio.dispatchEvent(new Event('timeupdate'));
};

describe('initPlayers', () => {
  it('shows the length of each clip before it loads', () => {
    const { first, second } = setup();
    expect(first.wave.getAttribute('aria-valuetext')).toBe('0:00 / 0:08');
    expect(second.wave.getAttribute('aria-valuetext')).toBe('0:00 / 0:17');
    expect(first.progress.getAttribute('width')).toBe('0');
  });

  it('plays a clip on its key and pauses it on the next press', () => {
    const { first } = setup();
    first.play.click();
    expect(first.audio.paused).toBe(false);
    expect(first.play.getAttribute('aria-pressed')).toBe('true');
    expect(first.root.classList.contains('playing')).toBe(true);

    first.play.click();
    expect(first.audio.paused).toBe(true);
    expect(first.play.getAttribute('aria-pressed')).toBe('false');
    expect(first.root.classList.contains('playing')).toBe(false);
  });

  it('plays one clip at a time', () => {
    const { first, second } = setup();
    first.play.click();
    second.play.click();
    expect(first.audio.paused).toBe(true);
    expect(first.play.getAttribute('aria-pressed')).toBe('false');
    expect(second.audio.paused).toBe(false);
    expect(second.play.getAttribute('aria-pressed')).toBe('true');
  });

  it('draws the played part of the wave and tells the position', () => {
    const { first } = setup();
    first.play.click();
    at(first.audio, 4.25);
    expect(Number(first.progress.getAttribute('width'))).toBeCloseTo(100);
    expect(first.wave.getAttribute('aria-valuenow')).toBe('4');
    expect(first.wave.getAttribute('aria-valuetext')).toBe('0:04 / 0:08');
  });

  it('goes back to the start when a clip ends', () => {
    const { first } = setup();
    first.play.click();
    at(first.audio, 8.5);
    playing.delete(first.audio);
    first.audio.dispatchEvent(new Event('ended'));
    expect(first.audio.currentTime).toBe(0);
    expect(first.progress.getAttribute('width')).toBe('0');
  });

  it('plays from where the wave is pressed', () => {
    const { first, second } = setup();
    second.play.click();
    first.wave.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect;
    first.wave.dispatchEvent(new MouseEvent('click', { clientX: 300, bubbles: true }));
    expect(first.audio.currentTime).toBeCloseTo(4.25);
    expect(first.audio.paused).toBe(false);
    expect(second.audio.paused).toBe(true);
  });

  it('moves by the arrows within the clip, Home and End to its ends', () => {
    const { first } = setup();
    const key = (name: string) => {
      const event = new KeyboardEvent('keydown', { key: name, cancelable: true });
      first.wave.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(key('ArrowRight')).toBe(true);
    expect(first.audio.currentTime).toBe(SEEK_STEP);
    key('ArrowRight');
    expect(first.audio.currentTime).toBe(8.5);
    key('ArrowLeft');
    expect(first.audio.currentTime).toBe(8.5 - SEEK_STEP);
    key('Home');
    expect(first.audio.currentTime).toBe(0);
    key('End');
    expect(first.audio.currentTime).toBe(8.5);
    expect(key('Tab')).toBe(false);
    // the arrows don't start it
    expect(first.audio.paused).toBe(true);
  });

  it('counts the players it set up', () => {
    document.body.innerHTML = card('acid-bass', 8.5) + '<article data-player></article>';
    expect(initPlayers()).toBe(1);
  });
});
