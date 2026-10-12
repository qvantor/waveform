import { generateId } from './index';

describe('generateId', () => {
  it('generates unique alphanumeric ids', () => {
    const ids = Array.from({ length: 1000 }, generateId);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[0-9a-z]+$/));
  });
});
