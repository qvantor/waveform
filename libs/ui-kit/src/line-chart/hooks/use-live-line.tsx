import React from 'react';
import styled from 'styled-components';
import { useCanvas } from '../../common/hooks/use-canvas';
import { IDENTITY } from '../services/path';
import { useLineChartContext } from './use-line-chart-context';

// over the chart (in its overlay: HTML over its svg), as sharp as the screen
const Canvas = styled.canvas`
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;

// a canvas over a chart for what is drawn on it every frame (useLiveDraw): drawing on a canvas is no style, layout,
// paint nor raster of the page (a path's d changed every frame made Chrome paint the whole document, ~0.6 ms, and
// lay out the svg). `begin` clears it and gives its context in the coordinates of the chart's <g> (css px from the
// padding), null without one
export const useLiveCanvas = (testId?: string) => {
  const { width, height, padding } = useLineChartContext();
  const { canvas, begin } = useCanvas(width, height, padding);
  return [<Canvas {...canvas} data-testid={testId} />, begin] as const;
};

const SVG_MITER_LIMIT = 4;

// the path through `count` points (xs, ys) mapped by the scales x and y
export const tracePath = (
  context: CanvasRenderingContext2D,
  count: number,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  x = IDENTITY,
  y = IDENTITY
) => {
  context.beginPath();
  for (let i = 0; i < count; i++) {
    const px = x.k * xs[i] + x.b;
    const py = y.k * ys[i] + y.b;
    if (i === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
};

// strokes the path with the miter of an svg stroke: a spike of a wave ends as it did on the path (a canvas's goes
// 10 widths out)
export const strokePath = (context: CanvasRenderingContext2D, stroke: string, width: number) => {
  context.lineWidth = width;
  context.miterLimit = SVG_MITER_LIMIT;
  context.strokeStyle = stroke;
  context.stroke();
};

export interface LiveLineStyle {
  stroke: string;
  width: number;
  // under the line: the path closed from its last point to its first (as the fill of an open svg path), or the
  // area down to y0; at fillOpacity
  fill?: 'closed' | 'area';
  fillOpacity?: number;
}

// a coordinate to 0.1 px, as sharp as a line is drawn (a step of a knob often moves no point that much: nothing is
// drawn); 0 for one past any screen
const toPx = (value: number) => {
  const tenths = Math.round(value * 10);
  return tenths > -2e9 && tenths < 2e9 ? tenths / 10 : 0;
};

// a line of a chart on its canvas (useLiveCanvas): `draw` maps `count` points (xs, ys) by the scales x and y and
// draws them, only when a point moved by 0.1 px (or the canvas was cleared by a new size)
export const useLiveLine = ({ stroke, width, fill, fillOpacity = 1 }: LiveLineStyle, testId?: string) => {
  const [element, begin] = useLiveCanvas(testId);
  // the points drawn, the bottom of their area and the canvas they were drawn on
  const drawn = React.useMemo(
    () => ({
      xs: new Float64Array(0),
      ys: new Float64Array(0),
      count: -1,
      y0: NaN,
      begin: null as typeof begin | null,
    }),
    []
  );
  const draw = React.useCallback(
    (count: number, xs: ArrayLike<number>, ys: ArrayLike<number>, x = IDENTITY, y = IDENTITY, y0 = 0) => {
      if (drawn.xs.length < count) {
        drawn.xs = new Float64Array(count * 2);
        drawn.ys = new Float64Array(count * 2);
      }
      const bottom = toPx(y0);
      let same = drawn.count === count && drawn.begin === begin && drawn.y0 === bottom;
      for (let i = 0; i < count; i++) {
        const px = toPx(x.k * xs[i] + x.b);
        const py = toPx(y.k * ys[i] + y.b);
        if (same && (px !== drawn.xs[i] || py !== drawn.ys[i])) same = false;
        drawn.xs[i] = px;
        drawn.ys[i] = py;
      }
      if (same) return;
      drawn.count = count;
      drawn.y0 = bottom;
      drawn.begin = begin;
      const context = begin();
      if (!context || count === 0) return;
      tracePath(context, count, drawn.xs, drawn.ys);
      if (fill) {
        if (fill === 'area') {
          context.lineTo(drawn.xs[count - 1], bottom);
          context.lineTo(drawn.xs[0], bottom);
          context.closePath();
        }
        context.globalAlpha = fillOpacity;
        context.fillStyle = stroke;
        context.fill();
        context.globalAlpha = 1;
        // the line over its fill, not along the edges of the area
        if (fill === 'area') tracePath(context, count, drawn.xs, drawn.ys);
      }
      strokePath(context, stroke, width);
    },
    [drawn, begin, stroke, width, fill, fillOpacity]
  );
  return [element, draw] as const;
};
