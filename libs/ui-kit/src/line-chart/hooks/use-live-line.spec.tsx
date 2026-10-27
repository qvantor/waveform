import React from 'react';
import { render, screen } from '@testing-library/react';
import { drawn, svgPath } from '../../common/test-utils/canvas';
import { withElementSize } from '../../common/test-utils/element-size';
import { LineChart } from '../components';
import { Affine } from '../services/path';
import { LiveLineStyle, useLiveLine } from './use-live-line';

const at = (values: number[]) => Float64Array.from(values);

interface Props {
  style: LiveLineStyle;
  xs: number[];
  ys: number[];
  x?: Affine;
  y?: Affine;
  y0?: number;
  // the drawing of every render (draw is called again with the same points)
  onDraw?: (draw: () => void) => void;
}

const Live = ({ style, xs, ys, x, y, y0, onDraw }: Props) => {
  const [canvas, draw] = useLiveLine(style, 'live');
  React.useLayoutEffect(() => {
    const drawLine = () => draw(xs.length, at(xs), at(ys), x, y, y0);
    drawLine();
    onDraw?.(drawLine);
  });
  return canvas;
};

const LINE: LiveLineStyle = { stroke: '#00ff00', width: 2 };

const chart = (props: Props, padding: [number, number] = [3, 4]) => (
  <LineChart padding={padding} overlay={<Live {...props} />} />
);

describe('useLiveLine', () => {
  let restore = () => undefined as void;
  afterEach(() => restore());

  it('draws the points to 0.1 px on a canvas over the chart, in the coordinates of its padding', () => {
    restore = withElementSize(100, 50);
    render(chart({ style: LINE, xs: [0, 1.25, -0.04, -12.36], ys: [50, 99.94, 1234.567, -0.16] }));
    const canvas = screen.getByTestId('live') as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([100, 50]);
    const [line, ...rest] = drawn(canvas);
    expect(rest).toEqual([]);
    expect(svgPath(line)).toBe('M0,50L1.3,99.9L0,1234.6L-12.4,-0.2');
    expect([line.op, line.style, line.lineWidth, line.transform]).toEqual([
      'stroke',
      '#00ff00',
      2,
      [1, 0, 0, 1, 3, 4],
    ]);
  });

  it('maps the points by the scales, 0 for one it cannot draw', () => {
    restore = withElementSize(100, 50);
    render(
      chart({
        style: LINE,
        xs: [0, 1, Infinity],
        ys: [1, -1, NaN],
        x: { k: 100, b: 10 },
        y: { k: -2, b: 3 },
      })
    );
    expect(svgPath(drawn(screen.getByTestId('live'))[0])).toBe('M10,1L110,5L0,0');
  });

  it('draws again only when a point moved by 0.1 px', () => {
    restore = withElementSize(100, 50);
    let again = () => undefined as void;
    const props = { style: LINE, xs: [0, 10], ys: [5, 6], onDraw: (draw: () => void) => (again = draw) };
    const { rerender } = render(chart(props));
    const context = (screen.getByTestId('live') as HTMLCanvasElement).getContext('2d');
    const stroke = jest.spyOn(context as CanvasRenderingContext2D, 'stroke');
    again();
    rerender(chart({ ...props, ys: [5.04, 6] }));
    expect(stroke).not.toHaveBeenCalled();
    rerender(chart({ ...props, ys: [5.06, 6] }));
    expect(stroke).toHaveBeenCalledTimes(1);
    expect(svgPath(drawn(screen.getByTestId('live'))[0])).toBe('M0,5.1L10,6');
  });

  it('draws the same points again on a new canvas (cleared: a new size, ratio or padding)', () => {
    restore = withElementSize(100, 50);
    const props = { style: LINE, xs: [0, 10], ys: [5, 6] };
    const { rerender } = render(chart(props));
    const canvas = screen.getByTestId('live') as HTMLCanvasElement;
    const stroke = jest.spyOn(canvas.getContext('2d') as CanvasRenderingContext2D, 'stroke');
    rerender(chart(props, [5, 4]));
    expect(stroke).toHaveBeenCalledTimes(1);
    expect(drawn(canvas)[0].transform).toEqual([1, 0, 0, 1, 5, 4]);
  });

  it('fills under the line: the path closed, or the area down to y0 under the line', () => {
    restore = withElementSize(100, 50);
    const { unmount } = render(
      chart({ style: { ...LINE, fill: 'closed', fillOpacity: 0.3 }, xs: [0, 5, 10], ys: [0, 4, 0] })
    );
    const [fill, line] = drawn(screen.getByTestId('live'));
    expect([fill.op, fill.alpha, svgPath(fill)]).toEqual(['fill', 0.3, 'M0,0L5,4L10,0']);
    expect([line.op, line.alpha, svgPath(line)]).toEqual(['stroke', 1, 'M0,0L5,4L10,0']);
    unmount();
    render(chart({ style: { ...LINE, fill: 'area', fillOpacity: 0.15 }, xs: [0, 10], ys: [5, 6], y0: 20 }));
    const [area, edge] = drawn(screen.getByTestId('live'));
    expect([area.op, area.alpha, area.closed, svgPath(area)]).toEqual([
      'fill',
      0.15,
      true,
      'M0,5L10,6L10,20L0,20',
    ]);
    expect([edge.op, svgPath(edge)]).toEqual(['stroke', 'M0,5L10,6']);
  });
});
