import { FxNote, FxRoute, routedValue } from './fx-modulation';

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

// the times after `now` the envelopes the routes read have a corner at (within two of them each one is linear)
const corners = (note: FxNote, routes: FxRoute[], now: number) => {
  const times = new Set<number>();
  routes.forEach(({ env }) => {
    const { attack, hold, decay, release } = note.envelopes[env];
    [0, attack, attack + hold, attack + hold + decay].forEach((time) => {
      const at = note.start + time;
      if (note.release === null || at < note.release) times.add(at);
    });
    if (note.release !== null) {
      times.add(note.release);
      times.add(note.release + release);
    }
  });
  return [...times].filter((time) => time > now).sort((a, b) => a - b);
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
// GLIDE to the knob): map(the knob at t), base the knob itself. A stage where the knob reaches the end of its
// range is a curve too: it is clamped there
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
  const knob = (t: number) => routedValue(base, routes, note, t);
  const inside = (value: number) => value > min && value < max;
  holdParam(param, now);
  let from = now + GLIDE;
  param.linearRampToValueAtTime(map(knob(from)), from);
  corners(note, routes, from).forEach((time) => {
    const start = knob(from);
    const end = knob(time);
    // within a stage the knob goes one way: the same at both ends, it stays (an event marks where)
    if (start === end) param.setValueAtTime(map(end), time);
    else if (ramp === 'linear' && inside(start) && inside(end)) param.linearRampToValueAtTime(map(end), time);
    else if (ramp === 'exponential' && inside(start) && inside(end) && map(start) > 0 && map(end) > 0)
      param.exponentialRampToValueAtTime(map(end), time);
    else
      for (let i = 1; i <= CURVE_SEGMENTS; i++) {
        const at = i === CURVE_SEGMENTS ? time : from + ((time - from) * i) / CURVE_SEGMENTS;
        param.linearRampToValueAtTime(map(knob(at)), at);
      }
    from = time;
  });
};
