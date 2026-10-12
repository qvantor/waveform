import { vector2d } from './vector2d';

describe('vector2d', () => {
  it('creates vectors from values', () => {
    expect(vector2d.fromValues(1, 2)).toEqual([1, 2]);
    expect(vector2d.fromValues(3)).toEqual([3, 3]);
    expect(vector2d.fromValues(1, 0)).toEqual([1, 0]);
  });

  it('creates a vector from a mouse event', () => {
    expect(vector2d.fromMouseEvent(new MouseEvent('click', { clientX: 10, clientY: 20 }))).toEqual([10, 20]);
  });

  it('does arithmetic', () => {
    expect(vector2d.subtract([5, 3], [2, 4])).toEqual([3, -1]);
    expect(vector2d.abs([-3, 4])).toEqual([3, 4]);
    expect(vector2d.invertY([1, 2])).toEqual([1, -2]);
    expect(vector2d.addition([1, 2])).toBe(3);
  });

  it('compares vectors', () => {
    expect(vector2d.isEqual([1, 2], [1, 2])).toBe(true);
    expect(vector2d.isEqual([1, 2], [2, 1])).toBe(false);
  });
});
