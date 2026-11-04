import { BehaviorSubject } from 'rxjs';
import { setPlaybackStats } from '../../../../test-utils/user-agent';
import {
  canCountDropouts,
  DROPOUT_SECONDS,
  DROPOUT_WINDOW,
  REPORT_LAG,
  underrunEvents,
  watchDropouts,
} from './dropouts';

// a context whose count of dropouts the spec moves
const context = () => {
  const stats = { underrunEvents: 0 };
  return { audioCtx: { playbackStats: stats } as unknown as BaseAudioContext, stats };
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('underrunEvents', () => {
  it('is null where the browser counts none', () => {
    expect(underrunEvents({} as BaseAudioContext)).toBeNull();
    const { audioCtx, stats } = context();
    stats.underrunEvents = 2;
    expect(underrunEvents(audioCtx)).toBe(2);
  });
});

describe('canCountDropouts', () => {
  it('is the interface of the count with its field and the attribute of the context', () => {
    expect(canCountDropouts()).toBe(false);
    setPlaybackStats({ underrunEvents: false });
    expect(canCountDropouts()).toBe(false);
    setPlaybackStats({ underrunEvents: true });
    expect(canCountDropouts()).toBe(true);
    Reflect.deleteProperty(AudioContext.prototype, 'playbackStats');
    expect(canCountDropouts()).toBe(false);
  });
});

describe('watchDropouts', () => {
  const watch = () => {
    const { audioCtx, stats } = context();
    const $silenced = new BehaviorSubject(false);
    const onCount = jest.fn();
    const onTooMany = jest.fn();
    const subscription = watchDropouts(audioCtx, $silenced, onCount, onTooMany);
    // the count the browser gives at the next poll
    const second = (count = stats.underrunEvents) => {
      stats.underrunEvents = count;
      jest.advanceTimersByTime(1000);
    };
    // a dropout in each of the next seconds
    const dropouts = (seconds: number) => {
      for (let k = 0; k < seconds; k++) second(stats.underrunEvents + 1);
    };
    return { $silenced, onCount, onTooMany, second, dropouts, subscription };
  };

  it('reports the count once a second when it changed', () => {
    const { onCount, second } = watch();
    second();
    expect(onCount).not.toHaveBeenCalled();
    second(2);
    second();
    second(3);
    expect(onCount.mock.calls).toEqual([[2], [3]]);
  });

  it(`warns once at ${DROPOUT_SECONDS} seconds with dropouts within ${DROPOUT_WINDOW} s`, () => {
    const { onTooMany, second } = watch();
    // a burst counts as one second
    second(4);
    for (let k = 0; k < 20; k++) second();
    second(5);
    expect(onTooMany).not.toHaveBeenCalled();
    for (let k = 0; k < 30; k++) second();
    second(6);
    expect(onTooMany).toHaveBeenCalledTimes(1);
    second(7);
    second(8);
    second(9);
    expect(onTooMany).toHaveBeenCalledTimes(1);
  });

  it('forgets the seconds older than the window', () => {
    const { onTooMany, second } = watch();
    second(1);
    second(2);
    for (let k = 0; k < DROPOUT_WINDOW; k++) second();
    second(3);
    expect(onTooMany).not.toHaveBeenCalled();
  });

  it('counts the seconds of the clock, not the polls (a hidden page polls once a minute)', () => {
    const { onTooMany, dropouts } = watch();
    dropouts(2);
    // the timers of the page stopped for a minute, then a poll
    const now = performance.now.bind(performance);
    const clock = jest.spyOn(performance, 'now').mockImplementation(() => now() + DROPOUT_WINDOW * 1000);
    dropouts(1);
    expect(onTooMany).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it('reports, but does not count, the dropouts while the output is silenced', () => {
    const { $silenced, onCount, onTooMany, dropouts } = watch();
    $silenced.next(true);
    dropouts(DROPOUT_SECONDS);
    $silenced.next(false);
    // the browser shows them up to REPORT_LAG late
    dropouts(REPORT_LAG - 1);
    dropouts(DROPOUT_SECONDS - 1);
    expect(onTooMany).not.toHaveBeenCalled();
    expect(onCount).toHaveBeenCalledTimes(DROPOUT_SECONDS + REPORT_LAG + DROPOUT_SECONDS - 2);
    dropouts(1);
    expect(onTooMany).toHaveBeenCalledTimes(1);
  });

  it('stops polling once unsubscribed', () => {
    const { onCount, second, subscription } = watch();
    subscription.unsubscribe();
    second(1);
    expect(onCount).not.toHaveBeenCalled();
  });
});
