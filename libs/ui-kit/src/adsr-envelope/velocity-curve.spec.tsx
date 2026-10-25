import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { curveShape } from './envelope-line';
import { VelocityCurve } from './velocity-curve';

// a chart of 210 × 110 px: the curve 200 × 100 px inside its padding (10, 5)
const WIDTH = 220;
const HEIGHT = 110;

// jsdom has no layout: every observed element reports a fixed size
class ResizeObserverStub {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: WIDTH, height: HEIGHT } } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  disconnect() {
    // nothing to release
  }
}

beforeAll(() => {
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
});

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
      velocity={null}
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

  it('puts the dot of the last note on the curve, none before a note', () => {
    const { rerender, onCurveChange, onAmpChange } = setup({ k: 2 });
    expect(screen.queryByTestId('velocity-dot')).toBeNull();
    rerender(
      <VelocityCurve
        k={2}
        curveMax={10}
        onCurveChange={onCurveChange}
        amp={1}
        onAmpChange={onAmpChange}
        velocity={0.5}
      />
    );
    const dot = screen.getByTestId('velocity-dot');
    expect(Number(dot.getAttribute('cx'))).toBeCloseTo(100, 6);
    expect(Number(dot.getAttribute('cy'))).toBeCloseTo(100 * (1 - curveShape(2, 0.5)), 6);
  });

  it('shows Amp in percent over its knob', () => {
    setup({ amp: 0.25 });
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('Amp')).toBeTruthy();
  });
});
