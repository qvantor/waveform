import React from 'react';
import { useCanvas } from '../hooks/use-canvas';
import { onFrame } from './frame-ticker';
import { liveRoutes, ModTravel, Route, routedShare, routeSpans } from './mod-routes';

const NO_ROUTES: never[] = [];
const NO_SPANS: [number, number][] = [];

// paints the mark of a control at `share` of its travel on its canvas (cleared, in css px)
export type PaintMark = (context: CanvasRenderingContext2D, share: number) => void;

// the mark of a control: `paint` on a canvas of width × height css px
export interface MarkCanvas {
  paint: PaintMark;
  width: number;
  height: number;
}

// the mark of the routes of a control while they sound, on a canvas of its own (a drawing is no style, layout nor
// paint of the page: a moved element made Chrome raster the page and layerize it every frame): every frame it goes
// where the sum of the routes (Σ amount × level) moves the control from `position` (a share of its travel, clamped
// to it or around it: `wrap`; a share of the scale of the routes mapped to the travel by `travel`, ModTravel),
// painted again only when it moved; cleared while no route has a level. The control renders the canvas while a
// route is live
const useModMark = (
  modulations: Route[],
  position: number,
  { paint, width, height }: MarkCanvas,
  wrap: boolean,
  travel?: ModTravel['travel']
) => {
  const { canvas, begin } = useCanvas(width, height);
  const routes = React.useMemo(() => liveRoutes(modulations), [modulations]);
  React.useEffect(() => {
    if (routes.length === 0) return;
    let drawn: number | null = null;
    const draw = () => {
      const next = routedShare(position, routes, wrap, travel);
      if (next === drawn) return;
      drawn = next;
      const context = begin();
      if (context && next !== null) paint(context, next);
    };
    draw();
    const stop = onFrame(draw);
    return () => {
      stop();
      begin();
    };
  }, [routes, position, paint, wrap, travel, begin]);
  return { mark: canvas, live: routes.length > 0 };
};

// the routes of a control at `position` (a share of its travel; with `travel` of the scale of its routes,
// ModTravel): none while it is disabled, the props of the canvas of their mark (useModMark: rendered while `live`),
// the selected route and the spans it moves the control over, clamped to the travel or around it (`wrap`; none: it
// doesn't move it)
export const useModulations = <R extends Route>(
  routes: R[] | undefined,
  disabled: boolean,
  position: number,
  markCanvas: MarkCanvas,
  wrap = false,
  travel?: ModTravel['travel']
) => {
  const modulations: R[] = disabled || !routes ? NO_ROUTES : routes;
  const { mark, live } = useModMark(modulations, position, markCanvas, wrap, travel);
  const shown = modulations.find((route) => route.selected);
  const spans = React.useMemo(
    () => (shown ? routeSpans(position, shown, wrap, travel) : NO_SPANS),
    [position, shown, wrap, travel]
  );
  return { modulations, mark, live, shown, spans };
};
