import { interval, Observable } from 'rxjs';

// Chromium counts the device callbacks the context missed (playbackStats, refreshed once a second; Chrome 155
// has it, Chromium 133 not). At low latency on an M5 Pro a stall of the audio thread of 2–4 ms is absorbed, one
// of 6 ms is a dropout, of 8 ms two. The clocks of the context don't show them (currentTime and
// getOutputTimestamp go on as before), and Chromium 133 grows its FIFO after one without telling outputLatency
interface PlaybackStats {
  underrunEvents: number;
}

// null: the browser counts none
export const underrunEvents = (audioCtx: BaseAudioContext): number | null =>
  (audioCtx as BaseAudioContext & { playbackStats?: PlaybackStats }).playbackStats?.underrunEvents ?? null;

// the browser counts them: the interface of its stats with the field and the attribute of the context, so a
// renamed field of the experimental API, or an interface without the attribute, is none; known before a
// context is created (Chromium before 146 has none)
export const canCountDropouts = () => {
  const stats = (globalThis as { AudioPlaybackStats?: new () => PlaybackStats }).AudioPlaybackStats;
  return (
    typeof stats === 'function' &&
    'underrunEvents' in stats.prototype &&
    typeof AudioContext === 'function' &&
    'playbackStats' in AudioContext.prototype
  );
};

// a second with dropouts can be anything (the machine busy with another page for a moment); DROPOUT_SECONDS of
// them within DROPOUT_WINDOW seconds are the machine: low latency is too low for it
export const DROPOUT_SECONDS = 3;
export const DROPOUT_WINDOW = 60;
// the browser refreshes its count once a second and the poll comes once a second: a dropout shows up to 2 s
// after it happened
export const REPORT_LAG = 2;

// polls the count of the context once a second: onCount when it changed, onTooMany once. The seconds are those
// of the clock (performance.now): a hidden page polls once a minute in Chrome. Dropouts while the output is
// silenced (`$silenced`: a preset switch, its work on the audio thread) aren't low latency too low for the
// machine: they are reported, not counted, nor those seen within REPORT_LAG after
export const watchDropouts = (
  audioCtx: BaseAudioContext,
  $silenced: Observable<boolean>,
  onCount: (count: number) => void,
  onTooMany: () => void
) => {
  let last = 0;
  let warned = false;
  // the times (ms) of the polls the count grew at
  const times: number[] = [];
  // ms: dropouts seen before it aren't counted (Infinity while the output is silenced)
  let countsFrom = -Infinity;
  const subscription = $silenced.subscribe((silenced) => {
    if (silenced) countsFrom = Infinity;
    else if (countsFrom === Infinity) countsFrom = performance.now() + REPORT_LAG * 1000;
  });
  subscription.add(
    interval(1000).subscribe(() => {
      const count = underrunEvents(audioCtx) ?? 0;
      if (count === last) return;
      last = count;
      onCount(count);
      const now = performance.now();
      if (now < countsFrom) return;
      times.push(now);
      while (times[0] <= now - DROPOUT_WINDOW * 1000) times.shift();
      if (warned || times.length < DROPOUT_SECONDS) return;
      warned = true;
      onTooMany();
    })
  );
  return subscription;
};
