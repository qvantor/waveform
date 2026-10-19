import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { valueScale } from '../common/utils';
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

describe('Handle scales', () => {
  // the angle of the value from the start of the arc, as a share of its whole travel
  const share = (props: React.ComponentProps<typeof Handle>) => {
    const { container } = render(<Handle {...props} />);
    const circle = container.querySelector('[style*="rotate"]') as HTMLElement;
    const angle = Number(circle.style.transform.match(/rotate\(([-\d.e]+)rad\)/)?.[1]);
    const max = Math.PI / 1.2;
    return (angle + max) / (2 * max);
  };

  it('pow gives the short times most of the travel: of 32 s, 125 ms at a quarter, 2 s in the middle', () => {
    expect(share({ min: 0, max: 32, mode: 'pow', value: 0 })).toBeCloseTo(0);
    expect(share({ min: 0, max: 32, mode: 'pow', value: 0.125 })).toBeCloseTo(0.25);
    expect(share({ min: 0, max: 32, mode: 'pow', value: 2 })).toBeCloseTo(0.5);
    expect(share({ min: 0, max: 32, mode: 'pow', value: 32 })).toBeCloseTo(1);
  });

  it('linear and log as before', () => {
    expect(share({ min: 0, max: 32, value: 8 })).toBeCloseTo(0.25);
    expect(share({ min: 10, max: 1000, mode: 'log', value: 100 })).toBeCloseTo(0.5);
  });
});

describe('valueScale', () => {
  it('pow goes from a time to the travel and back', () => {
    const scale = valueScale('pow').domain([0, 32]).range([-100, 100]);
    [0, 0.0001, 0.005, 0.1, 1, 2.5, 31.9999, 32].forEach((time) =>
      expect(scale.invert(scale(time))).toBeCloseTo(time, 9)
    );
  });
});

describe('Handle modulation', () => {
  const modulation = (amount: number, id = 'env2') => ({ id, color: '#f1c40f', amount, label: id });
  // the start and the end angle of an arc path of d3 (it starts at its start angle on the outer radius)
  const angleOf = ({ x, y }: { x: number; y: number }) => Math.atan2(x, -y);
  const modArcs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-testid="mod-arc"]'));

  it('draws an arc of the color of the source from the value to the value + amount', () => {
    const { container } = render(<Handle min={0} max={1} value={0.5} modulations={[modulation(0.25)]} />);
    const [path] = modArcs(container);
    expect(path.getAttribute('fill')).toBe('#f1c40f');
    // from the top (0.5) a quarter of the travel clockwise
    const start = startPoint(path.getAttribute('d') ?? '');
    expect(angleOf(start)).toBeCloseTo(0);
  });

  it('clamps the arc to the scale, draws one per route and none at 0', () => {
    const { container } = render(
      <Handle
        min={0}
        max={1}
        value={1}
        modulations={[modulation(0.5), modulation(-0.5, 'env3'), modulation(0, 'env1')]}
      />
    );
    // the first is past max: nothing to draw, the second down to the middle
    const paths = modArcs(container);
    expect(paths).toHaveLength(1);
    expect(screen.getAllByTestId('amount-ring')).toHaveLength(3);
  });

  it('is a drop target with its id, its rings change and remove the routes', () => {
    const onChange = jest.fn();
    const onRemove = jest.fn();
    const { container } = render(
      <Handle
        min={0}
        max={1}
        value={0.5}
        modTarget='osc1.gain'
        modulations={[{ ...modulation(0.25), onChange, onRemove }]}
      />
    );
    expect(container.querySelector('[data-mod-target="osc1.gain"]')).not.toBeNull();
    const ring = screen.getByRole('slider', { name: 'env2' });
    fireEvent.keyDown(ring, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(0.26);
    fireEvent.doubleClick(ring);
    expect(onRemove).toHaveBeenCalled();
  });

  it('a disabled knob takes no source and hides its routes', () => {
    const { container } = render(
      <Handle min={0} max={1} value={0.5} disabled modTarget='filter.gain' modulations={[modulation(0.25)]} />
    );
    expect(container.querySelector('[data-mod-target]')).toBeNull();
    expect(modArcs(container)).toHaveLength(0);
    expect(screen.queryByTestId('amount-ring')).toBeNull();
  });
});
