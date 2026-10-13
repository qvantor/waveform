import React from 'react';
import { render } from '@testing-library/react';
import { Handle } from './index';

// size m: the arc outer radius is 21, angle 0 (the value 0 on a -1..1 knob) is the top point
const OUTER_RADIUS = 21;

const arcPaths = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('svg path')).map((path) => path.getAttribute('d') ?? '');

// the first point of an arc path, d3 starts it at the start angle on the outer radius
const startPoint = (d: string) => {
  const [x, y] = (d.match(/^M([^,]+),([^A]+)/) ?? []).slice(1).map(Number);
  return { x, y };
};

describe('Handle', () => {
  it('fills from min by default', () => {
    const { container } = render(<Handle min={-1} max={1} value={0} />);
    const [background, value] = arcPaths(container);
    expect(startPoint(value)).toEqual(startPoint(background));
  });

  it('has no fill when the value is min', () => {
    const { container } = render(<Handle min={-1} max={1} value={-1} />);
    expect(arcPaths(container)).toHaveLength(1);
  });

  it('fills from fillFrom to the value in both directions', () => {
    const { container, rerender } = render(<Handle min={-1} max={1} value={0} fillFrom={0} />);
    // only the background arc: no deviation, no fill
    expect(arcPaths(container)).toHaveLength(1);

    for (const value of [0.5, -0.5]) {
      rerender(<Handle min={-1} max={1} value={value} fillFrom={0} />);
      const paths = arcPaths(container);
      expect(paths).toHaveLength(2);
      const { x, y } = startPoint(paths[1]);
      expect(x).toBeCloseTo(0);
      expect(y).toBeCloseTo(-OUTER_RADIUS);
    }
  });
});
