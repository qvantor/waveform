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

// a new automation takes over LEAD seconds after now: its events reach the audio thread before it renders
// there. The main thread schedules them call by call, Chrome's audio thread may render a quantum between two
// of them; Firefox renders a device buffer ahead of currentTime
const LEAD = 0.01;

// the events after the point a param is held at are cancelled from this long after it: Firefox takes an event
// within a sample of the time as at it, and cancels the point too
const CANCEL_AFTER = 1e-4;

// linear: the param is linear in the knob (a linear ramp), exponential: the knob is a log one and the param is
// the knob (an exponential ramp), curve: anything else (the equal power mix, the pan split at 0), in segments
export type FxRamp = 'linear' | 'exponential' | 'curve';

// an event of an automation: a ramp from the event before to `value` at `time` (linear or exponential), a
// step there (set), or from there on towards `value` by `timeConstant` (target: setTargetAtTime, for ever)
interface ParamEvent {
  kind: 'linear' | 'exponential' | 'set' | 'target';
  value: number;
  time: number;
  timeConstant?: number;
}

// what this module scheduled on a param: the point it starts at (the value there; a hold: an event there) and
// the events after it, as the browser renders them. Every automation of the params of the fx goes through it
// (setParam, glideParam, holdParam, scheduleRouted), so a hold works out where the param is
interface Plan {
  point: ParamEvent;
  events: ParamEvent[];
}

const plans = new WeakMap<AudioParam, Plan>();

const schedule = (param: AudioParam, { kind, value, time, timeConstant = 0 }: ParamEvent) => {
  if (kind === 'linear') param.linearRampToValueAtTime(value, time);
  else if (kind === 'exponential') param.exponentialRampToValueAtTime(value, time);
  else if (kind === 'target') param.setTargetAtTime(value, time, timeConstant);
  else param.setValueAtTime(value, time);
};

// where a plan has the param at t, as an event at t of the stage t is in (a ramp of its kind, the same line up
// to t; within a step, a glide or after the last event a step to where it is). Before the point it starts at
// (held again within LEAD) at the value of the point: the line before it reaches it a little sooner
const plannedAt = ({ point, events }: Plan, t: number): ParamEvent => {
  if (t <= point.time) return { ...point, time: t };
  let from: { time: number; value: number } = point;
  for (const event of events) {
    if (event.kind === 'target') {
      if (event.time > t) break;
      const value =
        event.value + (from.value - event.value) * Math.exp(-(t - event.time) / (event.timeConstant ?? 1));
      return { kind: 'set', value, time: t };
    }
    if (event.time > t) {
      if (event.kind === 'set') break;
      const share = (t - from.time) / (event.time - from.time);
      const at =
        event.kind === 'linear'
          ? from.value + (event.value - from.value) * share
          : from.value * (event.value / from.value) ** share;
      return { kind: event.kind, value: at, time: t };
    }
    from = event;
  }
  return { kind: 'set', value: from.value, time: t };
};

// the param stays where its automation is at `at`, what was scheduled after it is cancelled; the event it is
// held at. Held at a point of its own line (the browser renders the same up to it), not by
// cancelAndHoldAtTime: that one leaves the value to the audio thread, and Chrome got it wrong (a click of the
// whole mix): over a ramp when the audio thread got to the hold before the next events were scheduled (it
// started them from 0; WebKit from somewhere else), over a setTargetAtTime when it was far behind. A param
// nothing was scheduled on here is at its value
const holdAt = (param: AudioParam, at: number): ParamEvent => {
  const plan = plans.get(param);
  const point = plan ? plannedAt(plan, at) : { kind: 'set' as const, value: param.value, time: at };
  schedule(param, point);
  param.cancelScheduledValues(at + CANCEL_AFTER);
  plans.set(param, { point, events: [] });
  return point;
};

// the param steps to `value` at `time`
export const setParam = (param: AudioParam, value: number, time: number) => {
  param.setValueAtTime(value, time);
  plans.set(param, { point: { kind: 'set', value, time }, events: [] });
};

// the param glides to `value` from `time` on (setTargetAtTime), from where it is then
export const glideParam = (param: AudioParam, value: number, time: number, timeConstant: number) => {
  const plan = plans.get(param);
  const from = plan ? plannedAt(plan, time).value : param.value;
  param.setTargetAtTime(value, time, timeConstant);
  plans.set(param, {
    point: { kind: 'set', value: from, time },
    events: [{ kind: 'target', value, time, timeConstant }],
  });
};

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

// a param leaves its automation where it is at `now` (then glides to its knob)
export const holdParam = (param: AudioParam, now: number) => {
  holdAt(param, now);
};

// schedules on `param` the knob moved by its routes from LEAD after `now` on (the automation before is left
// where it is then, GLIDE to the knob, or to its first corner if it comes sooner): map(the knob at t), base the
// knob itself. A stage where the knob goes past the end of its range is a curve too: it is clamped there. A
// stage goes up to its corner, where an envelope steps (an attack, a decay or a release of 0) the param steps
// with it
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
  const begin = now + LEAD;
  const events: ParamEvent[] = [];
  const linear = (value: number, time: number) => events.push({ kind: 'linear', value, time });
  const set = (value: number, time: number) => events.push({ kind: 'set', value, time });
  // the glide ends at the first corner if it comes sooner (a short attack is not skipped), stepping there
  // with the envelope
  const glide = begin + GLIDE - note.start;
  const [first = Infinity] = corners(note, routes, begin - note.start);
  let from = Math.min(glide, first);
  const glided = knob(from, true);
  linear(map(glided), from === glide ? begin + GLIDE : note.start + from);
  if (knob(from) !== glided) set(map(knob(from)), note.start + from);
  corners(note, routes, from).forEach((time) => {
    const at = note.start + time;
    const rawStart = raw(from);
    const rawEnd = raw(time, true);
    const start = clamp(rawStart);
    const end = clamp(rawEnd);
    const ramps = inside(rawStart) && inside(rawEnd);
    // within a stage the knob goes one way: the same at both ends, it stays (an event marks where)
    if (start === end) set(map(end), at);
    else if (ramp === 'linear' && ramps) linear(map(end), at);
    else if (ramp === 'exponential' && ramps && map(start) > 0 && map(end) > 0)
      events.push({ kind: 'exponential', value: map(end), time: at });
    else {
      for (let i = 1; i < CURVE_SEGMENTS; i++) {
        const t = from + ((time - from) * i) / CURVE_SEGMENTS;
        linear(map(knob(t)), note.start + t);
      }
      linear(map(end), at);
    }
    const next = knob(time);
    if (next !== end) set(map(next), at);
    from = time;
  });
  // worked out before: the events follow the hold call by call
  const point = holdAt(param, begin);
  events.forEach((event) => schedule(param, event));
  plans.set(param, { point, events });
};
