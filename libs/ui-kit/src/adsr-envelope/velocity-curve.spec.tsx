import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { withElementSize } from '../common/test-utils/element-size';
import { curveShape } from './envelope-line';
import { POINT_RADIUS } from './curve-handles';
import { NOTE_DOT_RADIUS } from './note-dot';
import { VelocityCurve, VelocityDot } from './velocity-curve';

// a chart of 208 × 108 px: the curve 200 × 100 px inside its inset of 4 px on every side
const INSET = 4;
const WIDTH = 200 + 2 * INSET;
const HEIGHT = 100 + 2 * INSET;

// jsdom has no layout: every observed element reports a fixed size
let restoreSize: () => void;
beforeAll(() => {
  restoreSize = withElementSize(WIDTH, HEIGHT);
});
afterAll(() => restoreSize());

const setup = (props: Partial<React.ComponentProps<typeof VelocityCurve>> = {}) => {
  const onCurveChange = jest.fn();
  const onAmpChange = jest.fn();
  const result = render(
    <VelocityCurve
      k={0}
      curveMax={10}
      onCurveChange={onCurveChange}
      amp={1}
      onAmpChange={onAmpChange}
      {...props}
    />
  );
  return { ...result, onCurveChange, onAmpChange };
};

describe('VelocityCurve', () => {
  it('has the point of its curve: a double click makes it a line, the arrows bend it', () => {
    const { onCurveChange } = setup({ k: 3 });
    const point = screen.getByRole('slider', { name: 'Velocity curve' });
    expect(point.getAttribute('aria-valuenow')).toBe('3');
    fireEvent.doubleClick(point);
    expect(onCurveChange).toHaveBeenLastCalledWith(0);
    act(() => {
      fireEvent.keyDown(point, { key: 'ArrowUp' });
    });
    expect(onCurveChange).toHaveBeenLastCalledWith(3.1);
  });

  it('puts the dot of a note on the curve: a child in the chart', () => {
    setup({ k: 2, children: <VelocityDot k={2} velocity={0.5} /> });
    const dot = screen.getByTestId('velocity-dot');
    expect(Number(dot.getAttribute('cx'))).toBeCloseTo(100, 6);
    expect(Number(dot.getAttribute('cy'))).toBeCloseTo(100 * (1 - curveShape(2, 0.5)), 6);
  });

  it('keeps the dot of a note whole at either end of the velocity: the chart clips', () => {
    expect(INSET).toBe(Math.ceil(POINT_RADIUS));
    const { container } = setup({
      k: 0,
      children: (
        <>
          <VelocityDot k={0} velocity={0} />
          <VelocityDot k={0} velocity={1} />
        </>
      ),
    });
    const [low, high] = screen.getAllByTestId('velocity-dot');
    const g = container.querySelector('svg > g');
    expect(g?.getAttribute('transform')).toBe(`translate(${INSET}, ${INSET})`);
    // in the coordinates of the chart: the bottom left and the top right corners of the curve, the dot within it
    const at = (dot: Element) => [
      Number(dot.getAttribute('cx')) + INSET,
      Number(dot.getAttribute('cy')) + INSET,
    ];
    const [lowX, lowY] = at(low);
    const [highX, highY] = at(high);
    expect(lowX - NOTE_DOT_RADIUS).toBeGreaterThanOrEqual(0);
    expect(lowY + NOTE_DOT_RADIUS).toBeLessThanOrEqual(HEIGHT);
    expect(highX + NOTE_DOT_RADIUS).toBeLessThanOrEqual(WIDTH);
    expect(highY - NOTE_DOT_RADIUS).toBeGreaterThanOrEqual(0);
  });

  it('shows Amp in percent over its knob', () => {
    setup({ amp: 0.25 });
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('Amp')).toBeTruthy();
  });
});
