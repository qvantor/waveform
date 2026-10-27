import { affine } from './path';

describe('affine', () => {
  it('is a linear scale as k·v + b', () => {
    const { k, b } = affine((v) => 10 + 100 * v);
    expect([k, b]).toEqual([100, 10]);
    expect(k * 0.25 + b).toBe(35);
  });
});
