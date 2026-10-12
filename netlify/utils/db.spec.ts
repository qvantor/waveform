import postgres from 'postgres';

jest.mock('postgres', () => jest.fn(() => ({ fake: true })));

const postgresMock = postgres as unknown as jest.Mock;

// db.ts caches the connection in the module, every test needs a fresh copy
const loadDb = () => {
  let module!: typeof import('./db');
  jest.isolateModules(() => {
    module = require('./db');
  });
  return module.db;
};

describe('db', () => {
  beforeEach(() => {
    postgresMock.mockClear();
    process.env.DATABASE_URL = 'postgres://localhost/test';
  });

  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  it('connects lazily with pooler friendly options', () => {
    const db = loadDb();
    expect(postgresMock).not.toHaveBeenCalled();
    expect(db()).toEqual({ fake: true });
    expect(postgresMock).toHaveBeenCalledWith('postgres://localhost/test', {
      prepare: false,
      max: 1,
      idle_timeout: 20,
    });
  });

  it('reuses one connection between calls', () => {
    const db = loadDb();
    expect(db()).toBe(db());
    expect(postgresMock).toHaveBeenCalledTimes(1);
  });

  it('throws without DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    expect(() => loadDb()()).toThrow('DATABASE_URL');
  });
});
