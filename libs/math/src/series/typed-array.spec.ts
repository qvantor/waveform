import { slice } from './typed-array';

describe('typedArray.slice', () => {
  const array = new Float32Array([0, 1, 2, 3, 4]);

  it('copies count items starting from index into a plain array', () => {
    const result = slice(array, 1, 3);
    expect(result).toEqual([1, 2, 3]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns an empty array for zero count', () => {
    expect(slice(array, 2, 0)).toEqual([]);
  });

  it('fills out-of-range items with undefined', () => {
    expect(slice(array, 4, 2)).toEqual([4, undefined]);
  });
});
