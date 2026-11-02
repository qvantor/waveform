import React from 'react';
import { render, screen } from '@testing-library/react';
import { SegmentDisplay } from './index';

const setup = (props: React.ComponentProps<typeof SegmentDisplay>) => {
  const { container } = render(<SegmentDisplay {...props} />);
  const svg = container.querySelector('svg') as SVGSVGElement;
  // the cells, left to right: each its 7 segments and its point
  const cells = [...svg.querySelectorAll('svg > g > g')];
  const lit = (cell: Element) =>
    [...cell.querySelectorAll('polygon[data-lit]')].map((polygon) => polygon.getAttribute('data-segment'));
  const point = (cell: Element) => cell.querySelector('circle')?.hasAttribute('data-lit');
  return { svg, cells, lit, point };
};

describe('SegmentDisplay', () => {
  it('lights the segments of each digit, the others faintly', () => {
    const { cells, lit } = setup({ value: '0123456789' });
    expect(cells.map(lit)).toEqual([
      ['a', 'b', 'c', 'd', 'e', 'f'],
      ['b', 'c'],
      ['a', 'b', 'd', 'e', 'g'],
      ['a', 'b', 'c', 'd', 'g'],
      ['b', 'c', 'f', 'g'],
      ['a', 'c', 'd', 'f', 'g'],
      ['a', 'c', 'd', 'e', 'f', 'g'],
      ['a', 'b', 'c'],
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      ['a', 'b', 'c', 'd', 'f', 'g'],
    ]);
    // every cell has all 7, the unlit ones faint
    const one = cells[1].querySelectorAll('polygon');
    expect(one).toHaveLength(7);
    expect([...one].map((polygon) => polygon.getAttribute('opacity'))).toEqual([
      '0.09',
      '1',
      '1',
      '0.09',
      '0.09',
      '0.09',
      '0.09',
    ]);
  });

  it('has a dash, a blank cell for a space and for any other character', () => {
    const { cells, lit } = setup({ value: '- x' });
    expect(cells.map(lit)).toEqual([['g'], [], []]);
  });

  it('lights the point of the character before it, of a blank cell when it comes first', () => {
    const { cells, lit, point } = setup({ value: '1.5' });
    expect(cells.map(lit)).toEqual([
      ['b', 'c'],
      ['a', 'c', 'd', 'f', 'g'],
    ]);
    expect(cells.map(point)).toEqual([true, false]);
    const first = setup({ value: '.5' });
    expect(first.cells.map(first.lit)).toEqual([[], ['a', 'c', 'd', 'f', 'g']]);
    expect(first.cells.map(first.point)).toEqual([true, false]);
  });

  it('draws the last `small` cells smaller, on the bottom of the others', () => {
    const { cells } = setup({ value: '120.50', small: 2 });
    expect(cells).toHaveLength(5);
    const scales = cells.map((cell) => /scale\(([\d.]+)\)/.exec(cell.getAttribute('transform') ?? '')?.[1]);
    expect(scales).toEqual(['1', '1', '1', '0.72', '0.72']);
    // a small cell moved down by what it lacks of the height (20 units)
    const y = (cell: Element) =>
      Number(/translate\([\d.]+, ([\d.]+)\)/.exec(cell.getAttribute('transform') ?? '')?.[1]);
    expect(y(cells[0])).toBe(0);
    expect(y(cells[4])).toBeCloseTo(20 * 0.28);
  });

  it('is as high as asked and as wide as its cells, named by its value', () => {
    const { svg } = setup({ value: ' 88.5 ', height: 20 });
    expect(screen.getByRole('img', { name: '88.5' })).toBe(svg);
    expect(svg.getAttribute('height')).toBe('20');
    const [, , viewWidth, viewHeight] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(viewHeight).toBe(20);
    expect(Number(svg.getAttribute('width'))).toBeCloseTo((20 * viewWidth) / viewHeight);
    // a cell more is wider, a small one less so
    const width = (props: React.ComponentProps<typeof SegmentDisplay>) =>
      Number(setup(props).svg.getAttribute('width'));
    expect(width({ value: '888' })).toBeGreaterThan(width({ value: '88' }));
    expect(width({ value: '888', small: 1 })).toBeLessThan(width({ value: '888' }));
    expect(width({ value: '88', height: 32 })).toBeCloseTo((width({ value: '88', height: 16 }) * 32) / 16);
  });
});
