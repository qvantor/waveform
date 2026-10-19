import { FxNote, FxRoute, routedUnclamped } from './fx-modulation';

// the knobs of the fx made of native nodes (the delay, the mix of every slot) follow the envelopes of the last
// note by automation: the envelopes are linear between their corners, so are the knobs they move (a log one is
// exponential), the browser ramps them exactly; no new node, nothing computed per block on the main thread

// the linear segments of a stage that is no single ramp. Not setValueCurveAtTime: an event inside a curve
// still running throws, and browsers differ in whether cancelScheduledValues removes it (a ramp it does: its
// time is its end)
const CURVE_SEGMENTS = 15;

// a new automation (a new note, a turned knob, changed routes) starts where the param is and reaches the
// envelope in GLIDE seconds: a new note starts its envelopes at 0, a step would click
const GLIDE = 0.01;

// linear: the param is linear in the knob (a linear ramp), exponential: the knob is a log one and the param is
// the knob (an exponential ramp), curve: anything else (the equal power mix, the pan split at 0), in segments
export type FxRamp = 'linear' | 'exponential' | 'curve';

// the times (seconds after the start of the note) after `from` the envelopes the routes read have a corner at
// (within two of them each one is linear): the sums the envelopes work out their stages with, so a corner is
// exactly where a stage ends (from the time of the context it would be off by a rounding, on either side)
const corners = (note: FxNote, routes: FxRoute[], from: number) => {
  const times = new Set<number>();
  const released = note.release === null ? Infinity : note.release - note.start;
  routes.forEach(({ env }) => {
    const { attack, hold, decay, release } = note.envelopes[env];
    [0, attack, attack + hold, attack + hold + decay].forEach((time) => {
      if (time < released) times.add(time);
    });
    if (released !== Infinity) {
      times.add(released);
      times.add(released + release);
    }
  });
  return [...times].filter((time) => time > from).sort((a, b) => a - b);
};

// a param leaves its automation where it is at `now` (then glides to its knob): cancelAndHoldAtTime, else
// (Firefox has none) the value read before the automation is cancelled
export const holdParam = (param: AudioParam, now: number) => {
  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(now);
    return;
  }
  const { value } = param;
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, now);
};

// schedules on `param` the knob moved by its routes from `now` on (the automation before is left where it is,
// GLIDE to the knob, or to its first corner if it comes sooner): map(the knob at t), base the knob itself. A
// stage where the knob goes past the end of its range is a curve too: it is clamped there. A stage goes up to
// its corner, where an envelope steps (an attack, a decay or a release of 0) the param steps with it
export const scheduleRouted = (
  param: AudioParam,
  now: number,
  note: FxNote,
  routes: FxRoute[],
  base: number,
  ramp: FxRamp,
  map: (value: number) => number = (value) => value
) => {
  const { min, max } = routes[0];
  // t: seconds after the start of the note; the knob as it is moved (raw) and clamped to its range
  const raw = (t: number, before = false) => routedUnclamped(base, routes, note, t, before);
  const clamp = (value: number) => Math.min(max, Math.max(min, value));
  const knob = (t: number, before = false) => clamp(raw(t, before));
  // a stage that stays within the range (its ends may be on its ends) is not clamped: a ramp
  const inside = (value: number) => value >= min && value <= max;
  holdParam(param, now);
  // the glide ends at the first corner if it comes sooner (a short attack is not skipped), stepping there
  // with the envelope
  const glide = now + GLIDE - note.start;
  const [first = Infinity] = corners(note, routes, now - note.start);
  let from = Math.min(glide, first);
  const glided = knob(from, true);
  param.linearRampToValueAtTime(map(glided), from === glide ? now + GLIDE : note.start + from);
  if (knob(from) !== glided) param.setValueAtTime(map(knob(from)), note.start + from);
  corners(note, routes, from).forEach((time) => {
    const at = note.start + time;
    const rawStart = raw(from);
    const rawEnd = raw(time, true);
    const start = clamp(rawStart);
    const end = clamp(rawEnd);
    const ramps = inside(rawStart) && inside(rawEnd);
    // within a stage the knob goes one way: the same at both ends, it stays (an event marks where)
    if (start === end) param.setValueAtTime(map(end), at);
    else if (ramp === 'linear' && ramps) param.linearRampToValueAtTime(map(end), at);
    else if (ramp === 'exponential' && ramps && map(start) > 0 && map(end) > 0)
      param.exponentialRampToValueAtTime(map(end), at);
    else {
      for (let i = 1; i < CURVE_SEGMENTS; i++) {
        const t = from + ((time - from) * i) / CURVE_SEGMENTS;
        param.linearRampToValueAtTime(map(knob(t)), note.start + t);
      }
      param.linearRampToValueAtTime(map(end), at);
    }
    const next = knob(time);
    if (next !== end) param.setValueAtTime(map(next), at);
    from = time;
  });
};
