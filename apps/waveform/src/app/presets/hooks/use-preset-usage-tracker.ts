import React from 'react';
import { interval, distinctUntilChanged, filter, map, merge } from 'rxjs';
import { USAGE_LISTEN_SECONDS, USAGE_STAY_SECONDS, UsageRequest } from '@waveform/preset-schema';
import { useInputController, useSynthCore } from '../../synth/common/modules';
import { CurrentPreset, usePresets } from '../modules/presets';

const NOTE_ACTIVITY_MS = 30 * 1000;

export type UsageEvent = Pick<UsageRequest, 'presetId' | 'event'>;

// a listen: USAGE_LISTEN_SECONDS a preset was actually played (audio is running, tab is visible and a note is held or
// was played or released recently), a stay: USAGE_STAY_SECONDS, both without switching to another preset, each sent
// once, when it is reached, to `report` (UsageReporter sends it). Presets skipped sooner (stepping with ◀ ▶, trying
// the presets of a list) are not counted: the top is stepped through the most, their listens would weigh against it.
// The score is the share of listeners who stayed (see recompute-scores). The preset opened on start is not counted:
// its listeners didn't choose it
export const usePresetUsageTracker = (report: (usage: UsageEvent) => void) => {
  const [{ audioCtx }] = useSynthCore();
  const [{ $onPress, $onRelease, $pressed }] = useInputController();
  const [{ $current }] = usePresets();
  // the latest callback: a new one doesn't restart the count
  const reportRef = React.useRef(report);
  reportRef.current = report;

  React.useEffect(() => {
    let lastNoteAt = 0;
    // played seconds of the current preset since it was opened, kept while the tab is hidden
    let playedSeconds = 0;
    // a held note (a pad, a drone) keeps the preset played
    const holding = () => Object.values($pressed.value).some((notes) => notes.length > 0);

    const subscriptions = [
      merge($onPress, $onRelease).subscribe(() => {
        lastNoteAt = Date.now();
      }),
      // another preset (or Init) ends the listen and the stay; the preset opened on start counts once it is chosen
      $current
        .pipe(
          map((current) => current?.id),
          distinctUntilChanged()
        )
        .subscribe(() => {
          playedSeconds = 0;
        }),
      interval(1000)
        .pipe(
          map(() => $current.value),
          filter(
            (current): current is CurrentPreset =>
              current !== null &&
              !current.auto &&
              audioCtx.state === 'running' &&
              document.visibilityState === 'visible' &&
              (holding() || Date.now() - lastNoteAt < NOTE_ACTIVITY_MS)
          )
        )
        .subscribe(({ id }) => {
          playedSeconds++;
          if (playedSeconds === USAGE_LISTEN_SECONDS) reportRef.current({ presetId: id, event: 'listen' });
          if (playedSeconds === USAGE_STAY_SECONDS) reportRef.current({ presetId: id, event: 'stay' });
        }),
    ];
    return () => subscriptions.forEach((subscription) => subscription.unsubscribe());
  }, [audioCtx, $onPress, $onRelease, $pressed, $current]);
};
