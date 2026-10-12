import { getEditToken, setEditToken } from './edit-tokens';

describe('edit tokens', () => {
  it('stores tokens per preset', () => {
    setEditToken('a', 'token-a');
    setEditToken('b', 'token-b');
    expect(getEditToken('a')).toBe('token-a');
    expect(getEditToken('b')).toBe('token-b');
    expect(getEditToken('c')).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('presetEditTokens') ?? '')).toEqual({
      a: 'token-a',
      b: 'token-b',
    });
  });

  it.each(['not json', 'null', '"string"'])('treats %s in storage as no tokens', (raw) => {
    localStorage.setItem('presetEditTokens', raw);
    expect(getEditToken('a')).toBeUndefined();
    setEditToken('a', 'token');
    expect(getEditToken('a')).toBe('token');
  });
});
