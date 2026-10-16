import handler, { config } from '../functions/usage.mjs';
import { createFakeSql } from './fake-sql';
import { context, ID as A, IP_HASH, IP_SALT, request } from './helpers';

const mockSql = createFakeSql();
jest.mock('../utils/db', () => ({ db: () => mockSql.sql }));

const send = (body: unknown, method = 'POST') => handler(request(method, '/api/usage', body), context);
const listen = { presetId: A, event: 'listen' };
const stay = { presetId: A, event: 'stay' };

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

it('stores the listen of the IP on the preset today, without a stay', async () => {
  const response = await send(listen);
  expect(response.status).toBe(204);

  expect(mockSql.queries).toHaveLength(1);
  const [{ text, values }] = mockSql.queries;
  expect(text).toMatch(
    /^INSERT INTO listens \(preset_id, ip_hash, heard, stayed\) SELECT id, \$1, current_date, NULL::date FROM presets WHERE id = \$2/
  );
  expect(values).toEqual([IP_HASH, A, IP_HASH]);
  expect(values).not.toContain('1.2.3.4');
});

it('renews the day of a listen at most once a day, keeping the stay', async () => {
  await send(listen);
  expect(mockSql.queries[0].text).toMatch(
    /ON CONFLICT \(preset_id, ip_hash\) DO UPDATE SET heard = EXCLUDED.heard WHERE listens.heard < EXCLUDED.heard$/
  );
});

it('stores a stay as a listen and a stay of today', async () => {
  const response = await send(stay);
  expect(response.status).toBe(204);

  const [{ text, values }] = mockSql.queries;
  expect(text).toMatch(
    /^INSERT INTO listens \(preset_id, ip_hash, heard, stayed\) SELECT id, \$1, current_date, current_date FROM presets WHERE id = \$2/
  );
  expect(values).toEqual([IP_HASH, A, IP_HASH]);
});

it('renews the days of a stay at most once a day', async () => {
  await send(stay);
  expect(mockSql.queries[0].text).toMatch(
    /ON CONFLICT \(preset_id, ip_hash\) DO UPDATE SET heard = EXCLUDED.heard, stayed = EXCLUDED.stayed WHERE listens.stayed IS NULL OR listens.stayed < EXCLUDED.stayed$/
  );
});

it.each([
  ['listens', listen],
  ['stays', stay],
])('does not store %s on hidden presets nor on the author’s own ones', async (_, body) => {
  await send(body);
  expect(mockSql.queries[0].text).toContain('WHERE id = $2 AND NOT hidden AND ip_hash <> $3 ON CONFLICT');
});

it('hashes the ip', async () => {
  await send(stay);
  await handler(request('POST', '/api/usage', stay), { ...context, ip: '5.6.7.8' });
  const [first, second] = mockSql.queries.map(({ values }) => values);
  expect(second[0]).not.toBe(first[0]);
});

it('rejects other methods with 405', async () => {
  const response = await send(undefined, 'GET');
  expect(response.status).toBe(405);
  expect(mockSql.queries).toHaveLength(0);
});

it.each([
  ['invalid JSON', '{'],
  ['an empty body', {}],
  ['an invalid preset id', { presetId: 'abc', event: 'stay' }],
  ['a preset id without an event', { presetId: A }],
  ['an unknown event', { presetId: A, event: 'open' }],
  ['the batch of seconds of older clients', { clientId: 'client', items: [{ presetId: A, seconds: 60 }] }],
])('rejects %s with 400', async (_, body) => {
  const response = await send(body);
  expect(response.status).toBe(400);
  expect(mockSql.queries).toHaveLength(0);
});

it('rejects bodies over 4 KB with 413', async () => {
  const response = await send({ ...stay, padding: 'x'.repeat(4 * 1024) });
  expect(response.status).toBe(413);
});

it('fails with 500 on database errors', async () => {
  mockSql.respond(/INSERT INTO listens/, new Error('connection refused'));
  const response = await send(stay);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Internal error' });
});
