import { onFrame } from './frame-ticker';
import { MIN_FRAME_MS } from './use-live-draw';

// ms a meter draws nothing before it sleeps: longer than the longest gap between two echoes of a tail (the time of
// the delay, 1 s at most, and its pan, 50 ms), so it doesn't sleep between them
export const QUIET_MS = 1500;

export interface MeterLoop {
  // awake (a voice sounds) the meter draws every frame; else it sleeps once it has drawn nothing for QUIET_MS
  setAwake: (awake: boolean) => void;
  stop: () => void;
}

// the loop of a meter of the output (the analysers of the header): `draw` on the frames of the screen, at most every
// MIN_FRAME_MS (every other frame of a 120 Hz screen), with the time of the frame (ms), returns whether it drew
// anything. Not awake, it sleeps once it has drawn nothing for QUIET_MS since it stopped being awake (the last
// voice ended: the tails of the fx come after it, a quiet stretch before doesn't count): no frame of the page, no
// commit of its canvas; awake again, it runs again. It starts awake
export const meterLoop = (draw: (time: number) => boolean): MeterLoop => {
  let awake = true;
  let stop: (() => void) | null = null;
  let calledAt = -Infinity;
  // the time of the first frame of those that drew nothing in a row since the last change of `awake` (null: none)
  let quietSince: number | null = null;
  const frame = (time: number) => {
    if (time - calledAt < MIN_FRAME_MS) return;
    calledAt = time;
    if (draw(time)) {
      quietSince = null;
      return;
    }
    quietSince ??= time;
    if (!awake && time - quietSince >= QUIET_MS) sleep();
  };
  const sleep = () => {
    stop?.();
    stop = null;
  };
  let stopped = false;
  stop = onFrame(frame);
  return {
    setAwake: (value) => {
      if (value === awake) return;
      awake = value;
      quietSince = null;
      if (awake && !stop && !stopped) stop = onFrame(frame);
    },
    stop: () => {
      stopped = true;
      sleep();
    },
  };
};
