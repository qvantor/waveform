import peaks from './peaks.json';

// the length (seconds, to 0.1) and the peaks (0..1, PEAKS of scripts/site/peaks.mjs) of a clip
export type Clip = { duration: number; peaks: number[] };

const CLIPS: Record<string, Clip> = peaks;

export const clipOf = (slug: string): Clip => {
  const clip = CLIPS[slug];
  if (!clip) throw new Error(`No peaks of the clip ${slug}: run scripts/site/peaks.mjs`);
  return clip;
};

// the height of the wave in the units of its viewBox (as wide as the peaks)
export const WAVE_HEIGHT = 40;
// the share of a step a bar takes
const BAR = 0.6;
// the shortest bar, so silence still shows the line
const MIN_BAR = 0.6;

// a vertical bar per peak around the middle (a stroke of BAR, butt caps): one path for the whole wave
export const wavePath = (values: number[]) => {
  const middle = WAVE_HEIGHT / 2;
  return values
    .map((peak, i) => {
      const half = Math.max(MIN_BAR, peak * (middle - 1));
      const x = i + 0.5;
      return `M${x} ${(middle - half).toFixed(1)}V${(middle + half).toFixed(1)}`;
    })
    .join('');
};

export const BAR_WIDTH = BAR;

// an ISO 8601 duration (PT16.7S): the datetime of <time> and the duration of an AudioObject
export const isoDuration = (seconds: number) => `PT${seconds}S`;
