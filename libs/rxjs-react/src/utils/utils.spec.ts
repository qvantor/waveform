import { isRecord } from './index';

describe('isRecord', () => {
  it('accepts plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it.each([null, undefined, [], [1], 'str', 1, true, () => undefined])('rejects %p', (value) => {
    expect(isRecord(value)).toBe(false);
  });
});
