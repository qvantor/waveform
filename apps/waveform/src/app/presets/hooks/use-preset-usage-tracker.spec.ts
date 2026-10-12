import { act, renderHook } from '@testing-library/react';
import { BehaviorSubject, Subject } from 'rxjs';
import { USAGE_MAX_ITEMS } from '@waveform/preset-schema';
import { setVisibility } from '../../../test-utils/visibility';
import { sendUsage } from '../services';
import { usePresetUsageTracker } from './use-preset-usage-tracker';

const audioCtx = { state: 'running' };
const mockOnPress$ = new Subject<unknown>();
const mockCurrent$ = new BehaviorSubject<{ id: string; name: string } | null>(null);

jest.mock('../../synth/common/modules', () => ({
  useSynthCore: () => [{ audioCtx }],
  useInputController: () => [{ $onPress: mockOnPress$ }],
}));
jest.mock('../modules/presets', () => ({ usePresets: () => [{ $current: mockCurrent$ }] }));
jest.mock('../services', () => ({
  getClientId: () => 'client',
  sendUsage: jest.fn(() => Promise.resolve()),
}));

const sendUsageMock = sendUsage as jest.MockedFunction<typeof sendUsage>;

const tick = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => {
  jest.useFakeTimers();
  audioCtx.state = 'running';
  mockCurrent$.next({ id: 'p1', name: 'Preset' });
});

afterEach(() => jest.useRealTimers());

describe('usePresetUsageTracker', () => {
  it('counts seconds after a note and flushes every minute', () => {
    renderHook(() => usePresetUsageTracker());
    mockOnPress$.next([4, 'A']);
    tick(60 * 1000);
    expect(sendUsageMock).toHaveBeenCalledTimes(1);
    // a note keeps the preset "played" for 30 seconds
    expect(sendUsageMock).toHaveBeenCalledWith(
      { clientId: 'client', items: [{ presetId: 'p1', seconds: 29 }] },
      false
    );
  });

  it('does not count without notes, preset, running audio or a visible tab', () => {
    renderHook(() => usePresetUsageTracker());
    tick(60 * 1000);

    mockOnPress$.next([4, 'A']);
    audioCtx.state = 'suspended';
    tick(5000);
    audioCtx.state = 'running';
    mockCurrent$.next(null);
    tick(5000);
    mockCurrent$.next({ id: 'p1', name: 'Preset' });
    setVisibility('hidden');
    tick(50 * 1000);
    expect(sendUsageMock).not.toHaveBeenCalled();
  });

  it('counts seconds per preset', () => {
    renderHook(() => usePresetUsageTracker());
    mockOnPress$.next([4, 'A']);
    tick(10 * 1000);
    mockCurrent$.next({ id: 'p2', name: 'Other' });
    mockOnPress$.next([4, 'A']);
    tick(50 * 1000);
    expect(sendUsageMock.mock.calls[0][0].items).toEqual([
      { presetId: 'p1', seconds: 10 },
      { presetId: 'p2', seconds: 29 },
    ]);
  });

  it('flushes with a beacon when the tab is hidden', () => {
    renderHook(() => usePresetUsageTracker());
    mockOnPress$.next([4, 'A']);
    tick(3000);
    setVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(sendUsageMock).toHaveBeenCalledWith(
      { clientId: 'client', items: [{ presetId: 'p1', seconds: 3 }] },
      true
    );

    // nothing left to send
    window.dispatchEvent(new Event('pagehide'));
    expect(sendUsageMock).toHaveBeenCalledTimes(1);
  });

  it('splits big flushes into batches', () => {
    renderHook(() => usePresetUsageTracker());
    for (let i = 0; i <= USAGE_MAX_ITEMS; i++) {
      mockCurrent$.next({ id: `p${i}`, name: '' });
      mockOnPress$.next([4, 'A']);
      tick(1000);
    }
    setVisibility('hidden');
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(sendUsageMock).toHaveBeenCalledTimes(2);
    expect(sendUsageMock.mock.calls[0][0].items).toHaveLength(USAGE_MAX_ITEMS);
    expect(sendUsageMock.mock.calls[1][0].items).toHaveLength(1);
  });

  it('stops tracking on unmount', () => {
    const { unmount } = renderHook(() => usePresetUsageTracker());
    mockOnPress$.next([4, 'A']);
    tick(1000);
    unmount();
    tick(60 * 1000);
    expect(sendUsageMock).not.toHaveBeenCalled();
  });
});
