import { affine, areaPath, linePath } from './path';

const at = (values: number[]) => Float64Array.from(values);

describe('linePath', () => {
  it('writes the points to 0.1 px', () => {
    expect(linePath(4, at([0, 1.25, -0.04, -12.36]), at([50, 99.94, 1234.567, -0.16]))).toBe(
      'M0,50L1.3,99.9L0,1234.6L-12.4,-0.2'
    );
    expect(linePath(0, at([]), at([]))).toBe('');
  });

  it('maps the points by the scales', () => {
    expect(
      linePath(
        2,
        at([0, 1]),
        at([1, -1]),
        affine((v) => 10 + 100 * v),
        { k: -2, b: 3 }
      )
    ).toBe('M10,1L110,5');
  });

  it('writes 0 for a value it cannot draw', () => {
    expect(linePath(2, at([Infinity, -Infinity]), at([NaN, 1e12]))).toBe('M0,0L0,0');
  });

  it('writes more points than its buffer holds', () => {
    const count = 5000;
    const d = linePath(
      count,
      at(Array.from({ length: count }, (_, i) => -i - 0.5)),
      at(Array(count).fill(-1e8))
    );
    expect(d.split('L')).toHaveLength(count);
    expect(d.endsWith(`L-${count - 1}.5,-100000000`)).toBe(true);
  });

  it('closes an area along y0', () => {
    expect(areaPath(linePath(2, at([0, 10]), at([5, 6])), 0, 10, 20)).toBe('M0,5L10,6L10,20L0,20Z');
    expect(areaPath('', 0, 0, 20)).toBe('');
  });
});
