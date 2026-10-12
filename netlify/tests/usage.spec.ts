import { USAGE_MAX_SECONDS } from '../../libs/preset-schema/src';
import { sha256 } from '../utils/http';
import handler, { config } from '../functions/usage.mjs';
import { createFakeSql } from './fake-sql';
import { context, ID as A, IP_HASH, IP_SALT, OTHER_ID as B, request } from './helpers';

const mockSql = createFakeSql();
jest.mock('../utils/db', () => ({ db: () => mockSql.sql }));

const send = (body: unknown, method = 'POST') => handler(request(method, '/api/usage', body), context);

beforeEach(() => {
  mockSql.reset();
  process.env.IP_HASH_SALT = IP_SALT;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('is routed to /api/usage', () => {
  expect(config.path).toBe('/api/usage');
});

it('stores play time per preset for the client', async () => {
  const response = await send({ clientId: 'client', items: [{ presetId: A, seconds: 30 }] });
  expect(response.status).toBe(204);

  expect(mockSql.queries).toHaveLength(1);
  const [{ text, values }] = mockSql.queries;
  expect(text).toMatch(/^INSERT INTO usage_daily/);
  const clientHash = sha256('client' + IP_HASH);
  expect(values).toEqual([clientHash, IP_HASH, [A], [30], clientHash, IP_HASH, 3, 1800]);
  expect(values).not.toContain('client');
  expect(values).not.toContain('1.2.3.4');
});

it('only counts visible presets and caps clients per IP and seconds per day', async () => {
  await send({ clientId: 'client', items: [{ presetId: A, seconds: 30 }] });
  const [{ text }] = mockSql.queries;
  expect(text).toContain('JOIN presets p ON p.id = i.preset_id AND NOT p.hidden');
  expect(text).toContain('count(DISTINCT u.client_hash)');
  expect(text).toContain('ON CONFLICT (preset_id, client_hash, day)');
  expect(text).toContain('LEAST(usage_daily.seconds + EXCLUDED.seconds, $8)');
});

it('merges items of the same preset up to the per batch limit', async () => {
  await send({
    clientId: 'client',
    items: [
      { presetId: A, seconds: 10 },
      { presetId: B, seconds: 20 },
      { presetId: A, seconds: 15 },
      { presetId: B, seconds: 500 },
      { presetId: B, seconds: 50 },
    ],
  });
  const [{ values }] = mockSql.queries;
  expect(values[2]).toEqual([A, B]);
  expect(values[3]).toEqual([25, USAGE_MAX_SECONDS]);
});

it('hashes the client id with the ip', async () => {
  await send({ clientId: 'client', items: [{ presetId: A, seconds: 1 }] });
  await handler(request('POST', '/api/usage', { clientId: 'client', items: [{ presetId: A, seconds: 1 }] }), {
    ...context,
    ip: '5.6.7.8',
  });
  const [first, second] = mockSql.queries.map(({ values }) => values);
  expect(second[1]).not.toBe(first[1]);
  expect(second[0]).not.toBe(first[0]);
});

it('rejects other methods with 405', async () => {
  const response = await send(undefined, 'GET');
  expect(response.status).toBe(405);
  expect(mockSql.queries).toHaveLength(0);
});

it.each([
  ['invalid JSON', '{'],
  ['no items', { clientId: 'client', items: [] }],
  ['an invalid preset id', { clientId: 'client', items: [{ presetId: 'abc', seconds: 1 }] }],
  ['zero seconds', { clientId: 'client', items: [{ presetId: A, seconds: 0 }] }],
  ['a missing client id', { items: [{ presetId: A, seconds: 1 }] }],
])('rejects %s with 400', async (_, body) => {
  const response = await send(body);
  expect(response.status).toBe(400);
  expect(mockSql.queries).toHaveLength(0);
});

it('rejects bodies over 4 KB with 413', async () => {
  const response = await send({ clientId: 'x'.repeat(4 * 1024), items: [{ presetId: A, seconds: 1 }] });
  expect(response.status).toBe(413);
});

it('fails with 500 on database errors', async () => {
  mockSql.respond(/usage_daily/, new Error('connection refused'));
  const response = await send({ clientId: 'client', items: [{ presetId: A, seconds: 1 }] });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Internal error' });
});
