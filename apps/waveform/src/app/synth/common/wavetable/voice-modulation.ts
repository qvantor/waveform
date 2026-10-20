import type { EnvelopeBlock } from '../envelope/envelope-block';

// the modulation of a voice in its processor (wavetable-osc-dsp.ts): its envelopes move its params, no
// native node and no input of an AudioParam (an input costs ~14% of a held note in Chrome all along)

// a route of a note: envelope `env` (0: ENV 1, 1: ENV 2, 2: ENV 3) moves `param` by amount × its level
// (0..1), in the units of the param (octaves for a log one: the base × 2^(amount × level)); the base plus
// every route is clamped to min..max, the range of the knob
export interface VoiceRoute {
  env: number;
  param: string;
  amount: number;
  min: number;
  max: number;
  log?: boolean;
}

// main thread → voice: the routes of a playing note changed (added, an amount, removed)
export interface VoiceRoutesMessage {
  routes: VoiceRoute[];
}

// seconds a changed amount glides on a playing note: a route added, its amount dragged or removed doesn't click
const ROUTE_GLIDE = 0.01;

interface Route {
  env: number;
  // its amount now, the one it glides to (a removed route glides to 0, then it is dropped) and the step per
  // sample of the glide
  amount: number;
  target: number;
  step: number;
  removed: boolean;
  // the level of its envelope the value of the param was worked out at
  level: number;
}

// a param the routes move: get() gives its base in a block (the array of the browser, the knob of the
// filter), set() the values the voice plays instead (null: the base again). Each is a function of its own, the
// accesses are by name: by a computed name V8 makes them megamorphic, slow enough to cost more than a held
// note's modulation
export interface ParamAccess {
  get: (params: Record<string, Float32Array>) => Float32Array;
  set: (values: Float32Array | null) => void;
}

// the routes of one param
interface Target {
  param: string;
  access: ParamAccess;
  routes: Route[];
  min: number;
  max: number;
  log: boolean;
  // its values in a block: one per sample, or one (the block is within flat stages of its envelopes)
  values: Float32Array;
  one: Float32Array;
  // the values set, and the base `one` was worked out of (NaN: not one value)
  current: Float32Array | null;
  base: number;
}

const BLOCK = 128;
// samples between the points a moving param is worked out at (as the pitch and the position of the voice)
const SEGMENT = 32;

// the routes of a voice: apply() replaces the params they move by base + Σ amount × level, clamped. While
// every envelope a param follows is in a flat stage (before the start, hold, sustain, after the release), its
// amounts don't glide and its base is constant, the param is one value: the voice treats it as a still knob
// (it plays its mix tables). A route of amount 0 is not sent at all, an envelope no route reads is not
// rendered (uses())
export const createVoiceModulation = (
  sampleRate: number,
  envelopes: EnvelopeBlock[],
  initial: VoiceRoute[],
  // the params a route may move (an unknown one is left out)
  accesses: Record<string, ParamAccess>
) => {
  const glide = Math.max(1, Math.round(ROUTE_GLIDE * sampleRate));
  let targets: Target[] = [];
  const used = envelopes.map(() => false);
  // a removed route has glided out: dropped at the next block
  let dropped = false;
  // the last block left every param one value as it was worked out (no glide, no moving envelope): until the
  // frame the flat stages of the envelopes the routes read last, they are not rendered and only the bases are
  // compared (-Infinity: not quiet). A constant envelope is read by its value: its values[a] is of the block it
  // was rendered in (the first one of the voice may start within it)
  let quietUntil = -Infinity;
  // some route moves a param, read every block: a field, not a getter
  const state = { active: false };

  const index = () => {
    quietUntil = -Infinity;
    targets = targets.filter((target) => {
      target.routes = target.routes.filter((route) => !(route.removed && route.amount === 0));
      // the last route gone: the base again
      if (target.routes.length === 0) target.access.set(null);
      return target.routes.length > 0;
    });
    used.fill(false);
    targets.forEach((target) => target.routes.forEach((route) => (used[route.env] = true)));
    state.active = targets.length > 0 || dropped;
  };

  // the routes of the note; a playing note glides from the amounts it has (a new route from 0, a missing one
  // to 0)
  const set = (routes: VoiceRoute[], gliding: boolean) => {
    quietUntil = -Infinity;
    targets.forEach((target) => target.routes.forEach((route) => (route.removed = true)));
    routes.forEach(({ env, param, amount, min, max, log = false }) => {
      const access = accesses[param];
      if (envelopes[env] === undefined || !access) return;
      let target = targets.find((item) => item.param === param);
      if (!target) {
        target = {
          param,
          access,
          routes: [],
          min,
          max,
          log,
          values: new Float32Array(BLOCK),
          one: new Float32Array(1),
          current: null,
          base: NaN,
        };
        targets.push(target);
      }
      Object.assign(target, { min, max, log, base: NaN });
      let route = target.routes.find((item) => item.env === env);
      if (!route) {
        route = { env, amount: gliding ? 0 : amount, target: amount, step: 0, removed: false, level: NaN };
        target.routes.push(route);
      }
      route.removed = false;
      route.target = amount;
    });
    targets.forEach((target) =>
      target.routes.forEach((route) => {
        if (route.removed) route.target = 0;
        route.step = (route.target - route.amount) / glide;
      })
    );
    index();
  };
  set(initial, false);

  return Object.assign(state, {
    set: (routes: VoiceRoute[]) => set(routes, true),
    // a route reads envelope k: it is rendered, unless the routes are quiet until past the block that ends at
    // `end` (its flat stage goes on)
    renders: (k: number, end: number) => used[k] && end > quietUntil,
    // the envelopes were released: they move again
    wake: () => (quietUntil = -Infinity),
    // a route raises the param (a positive amount)
    raises: (param: string) =>
      targets.some((target) => target.param === param && target.routes.some((route) => route.target > 0)),
    // the moved params of the samples a..b of a block of n (the envelopes the routes read are rendered over
    // a..b): each set through its access. A param that is one value, as in the last block (the same base, the
    // same levels, no glide), is left as it is: on a sustain the routes cost a few comparisons
    apply: (params: Record<string, Float32Array>, frame: number, a: number, b: number, n: number) => {
      // the routes that glided out in the last block go now: that block played their last values
      if (dropped) {
        dropped = false;
        index();
      }
      if (b <= a) return;
      if (frame + b <= quietUntil) {
        let still = true;
        for (let t = 0; still && t < targets.length; t++) {
          const base = targets[t].access.get(params);
          if (base.length !== 1 || base[0] !== targets[t].base) still = false;
        }
        if (still) return;
      }
      let quiet = true;
      for (let t = 0; t < targets.length; t++) {
        const target = targets[t];
        const { routes, min, max, log } = target;
        const base = target.access.get(params);
        let constant = base.length === 1;
        let same = constant && base[0] === target.base && target.current === target.one;
        for (let r = 0; r < routes.length; r++) {
          const route = routes[r];
          const envelope = envelopes[route.env];
          if (!envelope.constant || route.step !== 0) constant = same = false;
          else if (envelope.value !== route.level) same = false;
        }
        if (same) continue;
        if (constant) {
          let sum = 0;
          for (let r = 0; r < routes.length; r++) {
            const route = routes[r];
            route.level = envelopes[route.env].value;
            sum += route.amount * route.level;
          }
          const value = log ? base[0] * 2 ** sum : base[0] + sum;
          target.one[0] = Math.min(max, Math.max(min, value));
          target.base = base[0];
          if (target.current !== target.one) {
            target.current = target.one;
            target.access.set(target.one);
          }
          continue;
        }
        target.base = NaN;
        quiet = false;
        if (target.values.length !== n) target.values = new Float32Array(n);
        const values = target.values;
        // worked out every SEGMENT samples and at the last one (where the voice works out the pitch and the
        // position), linear in between: the envelopes and the glides are linear too, but at their corners
        const last = b - 1;
        let from = a;
        for (let p = a; ; p = Math.min(p + SEGMENT, last)) {
          let sum = 0;
          for (let r = 0; r < routes.length; r++) {
            const route = routes[r];
            const envelope = envelopes[route.env];
            let amount = route.amount;
            if (route.step !== 0) {
              amount += route.step * (p - a);
              if (route.step > 0 ? amount > route.target : amount < route.target) amount = route.target;
            }
            sum += amount * (envelope.constant ? envelope.value : envelope.values[p]);
          }
          const x = base.length > 1 ? base[p] : base[0];
          const value = log ? x * 2 ** sum : x + sum;
          values[p] = value < min ? min : value > max ? max : value;
          if (p > from) {
            const start = values[from];
            const slope = (values[p] - start) / (p - from);
            for (let i = from + 1; i < p; i++) values[i] = start + slope * (i - from);
          }
          if (p === last) break;
          from = p;
        }
        // the glides go on
        for (let r = 0; r < routes.length; r++) {
          const route = routes[r];
          if (route.step === 0) continue;
          route.amount += route.step * (b - a);
          if (route.step > 0 ? route.amount >= route.target : route.amount <= route.target) {
            route.amount = route.target;
            route.step = 0;
            if (route.removed) dropped = true;
          }
        }
        // the samples out of a..b as their neighbours: the block stays constant if a..b is
        values.fill(values[a], 0, a);
        values.fill(values[b - 1], b, n);
        target.current = values;
        target.access.set(values);
      }
      quietUntil = -Infinity;
      if (!quiet) return;
      quietUntil = Infinity;
      for (let k = 0; k < used.length; k++)
        if (used[k]) quietUntil = Math.min(quietUntil, envelopes[k].flatUntil);
    },
  });
};
