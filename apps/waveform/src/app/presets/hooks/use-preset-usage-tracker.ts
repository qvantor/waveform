import React from 'react';
import { fromEvent, interval, filter, map, merge } from 'rxjs';
import { chunk } from 'lodash';
import { USAGE_MAX_ITEMS } from '@waveform/preset-schema';
import { useInputController, useSynthCore } from '../../synth/common/modules';
import { usePresets } from '../modules/presets';
import { getClientId, sendUsage } from '../services';

const NOTE_ACTIVITY_MS = 30 * 1000;
const FLUSH_INTERVAL_MS = 60 * 1000;

// counts seconds a preset is actually played: audio is running, tab is visible and a note was played recently
export const usePresetUsageTracker = () => {
  const [{ audioCtx }] = useSynthCore();
  const [{ $onPress }] = useInputController();
  const [{ $current }] = usePresets();

  React.useEffect(() => {
    let lastNoteAt = 0;
    const seconds = new Map<string, number>();

    const flush = (beacon: boolean) => {
      if (seconds.size === 0) return;
      // at most FLUSH_INTERVAL_MS worth of seconds per preset, below USAGE_MAX_SECONDS
      const items = [...seconds].map(([presetId, total]) => ({ presetId, seconds: total }));
      seconds.clear();
      const clientId = getClientId();
      chunk(items, USAGE_MAX_ITEMS).forEach((batch) =>
        sendUsage({ clientId, items: batch }, beacon).catch(() => undefined)
      );
    };

    const subscriptions = [
      $onPress.subscribe(() => (lastNoteAt = Date.now())),
      interval(1000)
        .pipe(
          map(() => $current.value?.id),
          filter(
            (id): id is string =>
              Boolean(id) &&
              audioCtx.state === 'running' &&
              document.visibilityState === 'visible' &&
              Date.now() - lastNoteAt < NOTE_ACTIVITY_MS
          )
        )
        .subscribe((id) => seconds.set(id, (seconds.get(id) ?? 0) + 1)),
      interval(FLUSH_INTERVAL_MS).subscribe(() => flush(false)),
      merge(fromEvent(document, 'visibilitychange'), fromEvent(window, 'pagehide'))
        .pipe(filter(() => document.visibilityState === 'hidden'))
        .subscribe(() => flush(true)),
    ];
    return () => subscriptions.forEach((subscription) => subscription.unsubscribe());
  }, [audioCtx, $onPress, $current]);
};
