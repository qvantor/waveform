import { number } from '@waveform/math';

export interface Route {
  amount: number;
  // the level of the source now (0..1, null: none)
  level?: () => number | null;
  live?: boolean;
  // the route the control shows (its arc or its bar), its dot changes it
  selected?: boolean;
}

// the step the routes move a control by, a share of its travel: the DOM is written only when it moves, a sustain
// costs nothing
export const QUANTUM = 1000;

// the routes of a control that sound now (while voices play)
export const liveRoutes = <R extends Route>(routes: R[]) =>
  routes.filter((route) => route.live && route.level);

// where the routes move a control from `position` (a share of its travel): the sum of amount × level of each,
// clamped to the travel, in steps of QUANTUM; null while none of them has a level
export const routedShare = (position: number, routes: Route[]) => {
  let sum = 0;
  let heard = false;
  for (const { amount, level } of routes) {
    const value = level?.() ?? null;
    if (value === null) continue;
    heard = true;
    sum += amount * value;
  }
  return heard ? number.round(number.thresholds(position + sum, 0, 1), QUANTUM) : null;
};
