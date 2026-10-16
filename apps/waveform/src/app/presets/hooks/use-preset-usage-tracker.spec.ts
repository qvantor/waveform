import { act, renderHook } from '@testing-library/react';
import { BehaviorSubject, Subject } from 'rxjs';
import { setVisibility } from '../../../test-utils/visibility';
import { sendUsage } from '../services';
import { usePresetUsageTracker } from './use-preset-usage-tracker';

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
jest.mock('../services', () => ({ sendUsage: jest.fn(() => Promise.resolve()) }));

const sendUsageMock = sendUsage as jest.MockedFunction<typeof sendUsage>;

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
  sendUsageMock.mock.calls.filter(([body]) => body.event === event).map(([{ presetId }]) => presetId);
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
  it('sends a listen once the opened preset is played for 10 seconds, once', () => {
    renderHook(() => usePresetUsageTracker());
    tick(60 * 1000);
    expect(sendUsageMock).not.toHaveBeenCalled();

    note();
    tick(9 * 1000);
    expect(sendUsageMock).not.toHaveBeenCalled();
    tick(1000);
    expect(sendUsageMock).toHaveBeenCalledWith({ presetId: 'p1', event: 'listen' });
    play(30);
    expect(sentListens()).toEqual(['p1']);
  });

  it('sends a listen of every preset opened and played, also of a preset opened again', () => {
    renderHook(() => usePresetUsageTracker());
    play(10);
    mockCurrent$.next({ id: 'p2', name: 'Other' });
    play(10);
    mockCurrent$.next({ id: 'p3', name: 'Skipped' });
    mockCurrent$.next({ id: 'p1', name: 'Preset' });
    play(10);
    expect(sentListens()).toEqual(['p1', 'p2', 'p1']);
    expect(sentStays()).toEqual([]);
  });

  it('does not send listens of presets skipped within 10 seconds, as stepping through them with ◀ ▶', () => {
    renderHook(() => usePresetUsageTracker());
    ['p2', 'p3', 'p4', 'p1'].forEach((id) => {
      note();
      tick(9 * 1000);
      mockCurrent$.next({ id, name: id });
    });
    expect(sendUsageMock).not.toHaveBeenCalled();
  });

  it('keeps the same preset loaded again in its listen', () => {
    renderHook(() => usePresetUsageTracker());
    play(5);
    mockCurrent$.next({ id: 'p1', name: 'Renamed' });
    play(5);
    expect(sentListens()).toEqual(['p1']);
  });

  it('does not send listens on Init nor on the preset opened on start, choosing it later does', () => {
    mockCurrent$.next(null);
    renderHook(() => usePresetUsageTracker());
    play(30);
    mockCurrent$.next({ id: 'top', name: 'Top', auto: true });
    play(30);
    expect(sendUsageMock).not.toHaveBeenCalled();

    mockCurrent$.next({ id: 'top', name: 'Top' });
    expect(sendUsageMock).not.toHaveBeenCalled();
    play(10);
    expect(sentListens()).toEqual(['top']);
  });

  it('sends a preset played for a minute without switching as a stay once, when it is reached', () => {
    renderHook(() => usePresetUsageTracker());
    play(59);
    expect(sentStays()).toEqual([]);
    play(1);
    expect(sendUsageMock).toHaveBeenLastCalledWith({ presetId: 'p1', event: 'stay' });

    play(5 * 60);
    expect(sentListens()).toEqual(['p1']);
    expect(sentStays()).toEqual(['p1']);
  });

  it('does not count without notes, preset, running audio or a visible tab', () => {
    renderHook(() => usePresetUsageTracker());
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
    expect(sendUsageMock).not.toHaveBeenCalled();
  });

  it('keeps a preset played while a note is held and for 30 seconds after its release', () => {
    renderHook(() => usePresetUsageTracker());
    hold();
    tick(40 * 1000);
    expect(sentListens()).toEqual(['p1']);
    release();
    tick(25 * 1000);
    expect(sentStays()).toEqual(['p1']);
  });

  it('sends a stay of a pad held for a minute', () => {
    renderHook(() => usePresetUsageTracker());
    hold();
    tick(5 * 60 * 1000);
    expect(sentStays()).toEqual(['p1']);
  });

  it('stops counting 30 seconds after the last note is released', () => {
    renderHook(() => usePresetUsageTracker());
    hold();
    tick(20 * 1000);
    release();
    tick(5 * 60 * 1000);
    expect(sentStays()).toEqual([]);

    play(15);
    expect(sentStays()).toEqual(['p1']);
  });

  it('does not send stays of presets skipped within a minute, a preset opened again starts a new stay', () => {
    renderHook(() => usePresetUsageTracker());
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
    renderHook(() => usePresetUsageTracker());
    play(40);
    mockCurrent$.next({ id: 'p1', name: 'Renamed' });
    play(20);
    expect(sentStays()).toEqual(['p1']);
  });

  it('pauses a stay while the tab is hidden, audio is suspended or nothing is played', () => {
    renderHook(() => usePresetUsageTracker());
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

  it('sends the stays of presets played one after another, and of a preset played again', () => {
    renderHook(() => usePresetUsageTracker());
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
    renderHook(() => usePresetUsageTracker());
    play(5 * 60);
    expect(sendUsageMock).not.toHaveBeenCalled();

    mockCurrent$.next({ id: 'top', name: 'Top' });
    play(59);
    expect(sentStays()).toEqual([]);
    play(1);
    expect(sentStays()).toEqual(['top']);
  });

  it('ignores failed requests', async () => {
    sendUsageMock.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
    renderHook(() => usePresetUsageTracker());
    play(60);
    await act(() => Promise.resolve());
    expect(sentListens()).toEqual(['p1']);
    expect(sentStays()).toEqual(['p1']);
  });

  it('stops tracking on unmount', () => {
    const { unmount } = renderHook(() => usePresetUsageTracker());
    play(50);
    unmount();
    play(60);
    mockCurrent$.next({ id: 'p2', name: 'Other' });
    note();
    expect(sentListens()).toEqual(['p1']);
    expect(sentStays()).toEqual([]);
  });
});
