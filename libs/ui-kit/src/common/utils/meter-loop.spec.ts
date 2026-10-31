import { MeterLoop, meterLoop, QUIET_MS } from './meter-loop';
import { MIN_FRAME_MS } from './use-live-draw';

// the frames of the screen by hand: the callback scheduled, run with a timestamp
let scheduled: ((time: number) => void) | null = null;
let now = 0;
const original = {
  requestAnimationFrame: window.requestAnimationFrame,
  cancelAnimationFrame: window.cancelAnimationFrame,
};
// a frame of the screen `ms` after the last one (none scheduled: the page has no frame)
const tick = (ms = 1000 / 60) => {
  now += ms;
  const callback = scheduled;
  scheduled = null;
  callback?.(now);
};
const frames = (seconds: number, ms = 1000 / 60) => {
  for (let i = 0; i < (seconds * 1000) / ms; i++) tick(ms);
};

let loop: MeterLoop | null = null;
let drawn = false;
let calls: number[] = [];
const start = () => {
  loop = meterLoop((time) => {
    calls.push(time);
    return drawn;
  });
  return loop;
};

beforeEach(() => {
  now = 1000;
  drawn = false;
  calls = [];
  Object.assign(window, {
    requestAnimationFrame: (callback: (time: number) => void) => {
      scheduled = callback;
      return 1;
    },
    cancelAnimationFrame: () => {
      scheduled = null;
    },
  });
});

afterEach(() => {
  loop?.stop();
  loop = null;
  scheduled = null;
  Object.assign(window, original);
});

describe('meterLoop', () => {
  it(`draws at most every ${MIN_FRAME_MS} ms: every other frame of a 120 Hz screen`, () => {
    start();
    for (let i = 0; i < 8; i++) tick(1000 / 120);
    expect(calls).toHaveLength(4);
    calls.slice(1).forEach((time, i) => expect(time - calls[i]).toBeCloseTo(1000 / 60));
  });

  it('draws every frame of a 60 Hz screen', () => {
    start();
    frames(1);
    expect(calls).toHaveLength(60);
  });

  it(`sleeps once it has drawn nothing for ${QUIET_MS} ms while not awake: the page has no frame`, () => {
    start().setAwake(false);
    frames(QUIET_MS / 1000 - 0.1);
    expect(scheduled).not.toBeNull();
    frames(0.2);
    expect(scheduled).toBeNull();
    const before = calls.length;
    frames(1);
    expect(calls).toHaveLength(before);
  });

  it('stays awake through a quiet stretch shorter than the gap of an echo', () => {
    start().setAwake(false);
    frames(1);
    drawn = true;
    tick();
    drawn = false;
    frames(1);
    expect(scheduled).not.toBeNull();
  });

  it('never sleeps while awake (a voice sounds), even when it draws nothing', () => {
    start();
    frames(5);
    expect(scheduled).not.toBeNull();
  });

  it('counts the quiet from the end of the voice, not the silence before it', () => {
    const meter = start();
    // a voice silent at the output for long, then it ends: the tails after it get their QUIET_MS
    frames(3);
    meter.setAwake(false);
    frames(QUIET_MS / 1000 - 0.1);
    expect(scheduled).not.toBeNull();
    frames(0.2);
    expect(scheduled).toBeNull();
  });

  it('runs again once awake', () => {
    const meter = start();
    meter.setAwake(false);
    frames(2);
    expect(scheduled).toBeNull();
    meter.setAwake(true);
    expect(scheduled).not.toBeNull();
    const before = calls.length;
    frames(5);
    expect(calls.length - before).toBe(300);
  });

  it('stays stopped once stopped, awake or not', () => {
    const meter = start();
    meter.stop();
    expect(scheduled).toBeNull();
    meter.setAwake(false);
    meter.setAwake(true);
    expect(scheduled).toBeNull();
  });
});
