import { getClientId } from './client-id';

describe('getClientId', () => {
  it('creates an id once and keeps it in localStorage', () => {
    const id = getClientId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem('clientId')).toBe(id);
    expect(getClientId()).toBe(id);
  });

  it('reuses a stored id', () => {
    localStorage.setItem('clientId', 'stored');
    expect(getClientId()).toBe('stored');
  });
});
