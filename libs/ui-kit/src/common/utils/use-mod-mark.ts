import React from 'react';
import { number } from '@waveform/math';
import { onFrame } from './frame-ticker';
import { liveRoutes, Route, routedShare } from './mod-routes';

const NO_ROUTES: never[] = [];

// the mark of the routes of a control while they sound: every frame it goes where the sum of the routes
// (Σ amount × level) moves the control from `position` (a share of its travel, clamped to it), drawn without a
// render; hidden while no route is live or has a level
const useModMark = (
  modulations: Route[],
  position: number,
  place: (element: HTMLElement, position: number) => void
) => {
  const mark = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const element = mark.current;
    const routes = liveRoutes(modulations);
    if (!element || routes.length === 0) return;
    let drawn: number | null = null;
    const draw = () => {
      const next = routedShare(position, routes);
      if (next === drawn) return;
      if (next === null) element.style.visibility = 'hidden';
      else {
        place(element, next);
        if (drawn === null) element.style.visibility = 'visible';
      }
      drawn = next;
    };
    draw();
    const stop = onFrame(draw);
    return () => {
      stop();
      element.style.visibility = 'hidden';
    };
  }, [modulations, position, place]);
  return mark;
};

// the routes of a control at `position` (a share of its travel): none while it is disabled, the ref of their
// mark (useModMark), the selected route and where it moves the control to, clamped to the travel (undefined: it
// doesn't move it)
export const useModulations = <R extends Route>(
  routes: R[] | undefined,
  disabled: boolean,
  position: number,
  place: (element: HTMLElement, position: number) => void
) => {
  const modulations: R[] = disabled || !routes ? NO_ROUTES : routes;
  const mark = useModMark(modulations, position, place);
  const shown = modulations.find((route) => route.selected);
  const end = shown && number.thresholds(position + shown.amount, 0, 1);
  return { modulations, mark, shown, end: end === position ? undefined : end };
};
