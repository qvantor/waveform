import { number } from '@waveform/math';

export interface Route {
  amount: number;
  // the level of the source now (0..1, null: none)
  level?: () => number | null;
  live?: boolean;
  // the route the control shows (its arc or its bar), its dot changes it
  selected?: boolean;
  // it moves the control around its value: amount × (level - ½) (else up from it, amount × level)
  bipolar?: boolean;
}

// the step the routes move a control by, a share of its travel: the DOM is written only when it moves, a sustain
// costs nothing
export const QUANTUM = 1000;

// the share of a control around a cycle (`wrap`: the Phase of an LFO) or clamped to its travel
const toTravel = (share: number, wrap: boolean) =>
  wrap ? share - Math.floor(share) : number.thresholds(share, 0, 1);

// the spans of the travel a route moves a control over from `position` (shares, the lower first): up to position +
// amount, a bipolar one position ± amount / 2; clamped to the travel, or around it (`wrap`: a span over an end is
// two, from the other end on); none: it doesn't move it
export const routeSpans = (
  position: number,
  { amount, bipolar }: Route,
  wrap = false
): [number, number][] => {
  const [a, b] = bipolar ? [position - amount / 2, position + amount / 2] : [position, position + amount];
  const [low, high] = [Math.min(a, b), Math.max(a, b)];
  if (!wrap || (low >= 0 && high <= 1)) {
    const [from, to] = [number.thresholds(low, 0, 1), number.thresholds(high, 0, 1)];
    return from === to ? [] : [[from, to]];
  }
  if (high - low >= 1) return [[0, 1]];
  // over an end: from `start` to it, then from the other end to `end`
  const [start, end] = low < 0 ? [low + 1, high] : [low, high - 1];
  const spans: [number, number][] = [];
  if (start < 1) spans.push([start, 1]);
  if (end > 0) spans.push([0, end]);
  return spans;
};

// the routes of a control that sound now (while voices play)
export const liveRoutes = <R extends Route>(routes: R[]) =>
  routes.filter((route) => route.live && route.level);

// where the routes move a control from `position` (a share of its travel): the sum of amount × level of each
// (a bipolar one amount × (level - ½)), clamped to the travel or around it (`wrap`), in steps of QUANTUM; null
// while none of them has a level
export const routedShare = (position: number, routes: Route[], wrap = false) => {
  let sum = 0;
  let heard = false;
  for (const { amount, level, bipolar } of routes) {
    const value = level?.() ?? null;
    if (value === null) continue;
    heard = true;
    sum += amount * (bipolar ? value - 0.5 : value);
  }
  return heard ? number.round(toTravel(position + sum, wrap), QUANTUM) : null;
};
