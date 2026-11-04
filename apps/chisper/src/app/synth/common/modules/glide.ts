import type { ParamAutomation } from '../wavetable/wavetable-engine';

// the glide of the pitch of a voice (portamento, the slide of mono): convex in pitch, it leaves the note it
// comes from fast and slows down into the target, there exactly after its time.
// GLIDE_SEGMENTS exponential ramps of the frequency (each linear in pitch): not setValueCurveAtTime, an event
// inside a curve still running throws (the next note interrupts a glide)

export const GLIDE_SEGMENTS = 8;

// a glide of the frequency from `from` to `to` (Hz) over `seconds` from `start` (seconds of the context); 0
// seconds: at once
export interface Glide {
  from: number;
  to: number;
  start: number;
  seconds: number;
}

// the share of the interval (in pitch) passed at the share x of the time: p(t) = p0 + (p1 - p0)·(1 - (1 - t/T)²)
const shape = (x: number) => 1 - (1 - x) ** 2;

// the frequency at point i of the curve (0..GLIDE_SEGMENTS), the last one the target itself
const point = ({ from, to }: Glide, i: number) =>
  i >= GLIDE_SEGMENTS ? to : from * (to / from) ** shape(i / GLIDE_SEGMENTS);

// what was scheduled after the point a glide is held at is cancelled from this long after it: a cancel takes the
// events at its time too, the point among them
const CANCEL_AFTER = 1e-4;

// the ramps of a glide on `param` (none for 0 seconds); the value at its start is the caller's
export const scheduleGlide = (param: ParamAutomation, glide: Glide) => {
  if (glide.seconds <= 0) return;
  for (let i = 1; i <= GLIDE_SEGMENTS; i++)
    param.exponentialRampToValueAtTime(point(glide, i), glide.start + (glide.seconds * i) / GLIDE_SEGMENTS);
};

// the frequency at `t` (seconds of the context) as its timeline ramps it, exponential between the points: where
// a glide the next note interrupts goes on from
export const glideValue = (glide: Glide, t: number) => {
  const { from, to, start, seconds } = glide;
  if (seconds <= 0 || t >= start + seconds) return to;
  if (t <= start) return from;
  const x = ((t - start) / seconds) * GLIDE_SEGMENTS;
  const i = Math.floor(x);
  const a = point(glide, i);
  return a * (point(glide, i + 1) / a) ** (x - i);
};

// a pitch that stays at `value` from `start`
export const steady = (value: number, start: number): Glide => ({
  from: value,
  to: value,
  start,
  seconds: 0,
});

// `param`, on `current`, goes to `to` (Hz) from `start` on: in `seconds` along the curve from where current has
// it then (0: a step there). Held at that point of its own line (its timeline renders the same up to it), what
// comes after it cancelled, then the ramps (no cancelAndHoldAtTime). The new glide
export const glideFrom = (
  param: ParamAutomation,
  current: Glide,
  to: number,
  start: number,
  seconds: number
) => {
  const glide: Glide =
    seconds > 0 ? { from: glideValue(current, start), to, start, seconds } : steady(to, start);
  param.setValueAtTime(glide.from, start);
  param.cancelScheduledValues(start + CANCEL_AFTER);
  scheduleGlide(param, glide);
  return glide;
};
