import { act, renderHook } from '@testing-library/react';
import { BehaviorSubject, Subject } from 'rxjs';
import { setVisibility } from '../../../test-utils/visibility';
import { usePresetUsageTracker, UsageEvent } from './use-preset-usage-tracker';

const audioCtx = { state: 'running' };
const mockOnPress$ = new Subject<unknown>();
const mockOnRelease$ = new Subject<unknown>();
const mockPressed$ = new BehaviorSubject<Record<number, string[]>>({ 4: [] });
const mockCurrent$ = new BehaviorSubject<{ id: string; name: string; auto?: boolean } | null>(null);

jest.mock('../../synth/common/modules', () => ({
  useSynthCore: () => [{ audioCtx }],
  useInputController: () => [{ $onPress: mockOnPress$, $onRelease: mockOnRelease$, $pressed: mockPressed$ }],
}));
jest.mock('../modules/presets', () => ({ usePresets: () => [{ $current: mockCurrent$ }] }));

const report = jest.fn<void, [UsageEvent]>();
const track = () => renderHook(() => usePresetUsageTracker(report));

const tick = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

const note = () => mockOnPress$.next([4, 'A']);
const hold = () => {
  mockOnPress$.next([4, 'A']);
  mockPressed$.next({ 4: ['A'] });
};
const release = () => {
  mockOnRelease$.next([4, 'A']);
  mockPressed$.next({ 4: [] });
};

// plays the current preset for these seconds: a note keeps it played for 30 seconds
const play = (seconds: number) => {
  for (let left = seconds; left > 0; left -= 20) {
    note();
    tick(Math.min(left, 20) * 1000);
  }
};

const sent = (event: 'listen' | 'stay') =>
  report.mock.calls.filter(([usage]) => usage.event === event).map(([{ presetId }]) => presetId);
const sentListens = () => sent('listen');
const sentStays = () => sent('stay');

beforeEach(() => {
  jest.useFakeTimers();
  audioCtx.state = 'running';
  mockPressed$.next({ 4: [] });
  mockCurrent$.next({ id: 'p1', name: 'Preset' });
});

afterEach(() => jest.useRealTimers());

describe('usePresetUsageTracker', () => {
  it('reports a listen once the opened preset is played for 10 seconds, once', () => {
    track();
    tick(60 * 1000);
    expect(report).not.toHaveBeenCalled();

    note();
    tick(9 * 1000);
    expect(report).not.toHaveBeenCalled();
    tick(1000);
    expect(report).toHaveBeenCalledWith({ presetId: 'p1', event: 'listen' });
    play(30);
    expect(sentListens()).toEqual(['p1']);
  });

  it('reports a listen of every preset opened and played, also of a preset opened again', () => {
    track();
    play(10);
    mockCurrent$.next({ id: 'p2', name: 'Other' });
    play(10);
    mockCurrent$.next({ id: 'p3', name: 'Skipped' });
    mockCurrent$.next({ id: 'p1', name: 'Preset' });
    play(10);
    expect(sentListens()).toEqual(['p1', 'p2', 'p1']);
    expect(sentStays()).toEqual([]);
  });

  it('does not report listens of presets skipped within 10 seconds, as stepping through them with ◀ ▶', () => {
    track();
    ['p2', 'p3', 'p4', 'p1'].forEach((id) => {
      note();
      tick(9 * 1000);
      mockCurrent$.next({ id, name: id });
    });
    expect(report).not.toHaveBeenCalled();
  });

  it('keeps the same preset loaded again in its listen', () => {
    track();
    play(5);
    mockCurrent$.next({ id: 'p1', name: 'Renamed' });
    play(5);
    expect(sentListens()).toEqual(['p1']);
  });

  it('does not report listens on Init nor on the preset opened on start, choosing it later does', () => {
    mockCurrent$.next(null);
    track();
    play(30);
    mockCurrent$.next({ id: 'top', name: 'Top', auto: true });
    play(30);
    expect(report).not.toHaveBeenCalled();

    mockCurrent$.next({ id: 'top', name: 'Top' });
    expect(report).not.toHaveBeenCalled();
    play(10);
    expect(sentListens()).toEqual(['top']);
  });

  it('reports a preset played for a minute without switching as a stay once, when it is reached', () => {
    track();
    play(59);
    expect(sentStays()).toEqual([]);
    play(1);
    expect(report).toHaveBeenLastCalledWith({ presetId: 'p1', event: 'stay' });

    play(5 * 60);
    expect(sentListens()).toEqual(['p1']);
    expect(sentStays()).toEqual(['p1']);
  });

  it('does not count without notes, preset, running audio or a visible tab', () => {
    track();
    tick(60 * 1000);

    note();
    audioCtx.state = 'suspended';
    tick(5000);
    audioCtx.state = 'running';
    mockCurrent$.next(null);
    tick(5000);
    mockCurrent$.next({ id: 'p1', name: 'Preset' });
    setVisibility('hidden');
    play(120);
    expect(report).not.toHaveBeenCalled();
  });

  it('keeps a preset played while a note is held and for 30 seconds after its release', () => {
    track();
    hold();
    tick(40 * 1000);
    expect(sentListens()).toEqual(['p1']);
    release();
    tick(25 * 1000);
    expect(sentStays()).toEqual(['p1']);
  });

  it('reports a stay of a pad held for a minute', () => {
    track();
    hold();
    tick(5 * 60 * 1000);
    expect(sentStays()).toEqual(['p1']);
  });

  it('stops counting 30 seconds after the last note is released', () => {
    track();
    hold();
    tick(20 * 1000);
    release();
    tick(5 * 60 * 1000);
    expect(sentStays()).toEqual([]);

    play(15);
    expect(sentStays()).toEqual(['p1']);
  });

  it('does not report stays of presets skipped within a minute, a preset opened again starts a new stay', () => {
    track();
    play(40);
    mockCurrent$.next({ id: 'p2', name: 'Other' });
    play(10);
    mockCurrent$.next({ id: 'p1', name: 'Preset' });
    play(40);
    mockCurrent$.next(null);
    tick(5 * 60 * 1000);
    expect(sentStays()).toEqual([]);
  });

  it('keeps the same preset loaded again in its stay', () => {
    track();
    play(40);
    mockCurrent$.next({ id: 'p1', name: 'Renamed' });
    play(20);
    expect(sentStays()).toEqual(['p1']);
  });

  it('pauses a stay while the tab is hidden, audio is suspended or nothing is played', () => {
    track();
    play(20);
    setVisibility('hidden');
    play(60);
    setVisibility('visible');
    play(20);
    audioCtx.state = 'suspended';
    play(60);
    audioCtx.state = 'running';
    tick(2 * 60 * 1000);
    expect(sentStays()).toEqual([]);

    play(20);
    expect(sentStays()).toEqual(['p1']);
  });

  it('reports the stays of presets played one after another, and of a preset played again', () => {
    track();
    play(70);
    mockCurrent$.next({ id: 'p2', name: 'Other' });
    play(60);
    mockCurrent$.next({ id: 'p1', name: 'Preset' });
    play(60);
    expect(sentStays()).toEqual(['p1', 'p2', 'p1']);
    expect(sentListens()).toEqual(['p1', 'p2', 'p1']);
  });

  it('does not count the stay of the preset opened on start, choosing it later starts a stay', () => {
    mockCurrent$.next({ id: 'top', name: 'Top', auto: true });
    track();
    play(5 * 60);
    expect(report).not.toHaveBeenCalled();

    mockCurrent$.next({ id: 'top', name: 'Top' });
    play(59);
    expect(sentStays()).toEqual([]);
    play(1);
    expect(sentStays()).toEqual(['top']);
  });

  it('keeps counting with a new callback, reports to the latest one', () => {
    const latest = jest.fn<void, [UsageEvent]>();
    const { rerender } = renderHook(({ callback }) => usePresetUsageTracker(callback), {
      initialProps: { callback: report },
    });
    play(40);
    rerender({ callback: latest });
    play(20);
    expect(sentListens()).toEqual(['p1']);
    expect(latest.mock.calls).toEqual([[{ presetId: 'p1', event: 'stay' }]]);
  });

  it('stops tracking on unmount', () => {
    const { unmount } = track();
    play(50);
    unmount();
    play(60);
    mockCurrent$.next({ id: 'p2', name: 'Other' });
    note();
    expect(sentListens()).toEqual(['p1']);
    expect(sentStays()).toEqual([]);
  });
});
