import { env, envNumber } from './env';

describe('env', () => {
  afterEach(() => {
    delete process.env.TEST_VAR;
  });

  it('returns the value', () => {
    process.env.TEST_VAR = 'value';
    expect(env('TEST_VAR')).toBe('value');
  });

  it('throws when the variable is missing or empty', () => {
    expect(() => env('TEST_VAR')).toThrow('env variable TEST_VAR is not set');
    process.env.TEST_VAR = '';
    expect(() => env('TEST_VAR')).toThrow('env variable TEST_VAR is not set');
  });
});

describe('envNumber', () => {
  afterEach(() => {
    delete process.env.TEST_NUMBER;
  });

  it('parses a positive number', () => {
    process.env.TEST_NUMBER = '7';
    expect(envNumber('TEST_NUMBER', 2)).toBe(7);
    process.env.TEST_NUMBER = '0.5';
    expect(envNumber('TEST_NUMBER', 2)).toBe(0.5);
  });

  it.each([undefined, '', 'abc', '0', '-3', 'Infinity'])('falls back for %p', (value) => {
    if (value !== undefined) process.env.TEST_NUMBER = value;
    expect(envNumber('TEST_NUMBER', 2)).toBe(2);
  });
});
