import { PRESET_NAME_MAX_LENGTH, presetDataSchema, presetHash } from '../../libs/preset-schema/src';
import { sha256 } from '../utils/http';
import { verifyTurnstile } from '../utils/turnstile';
import handler, { config } from '../functions/presets.mjs';
import { createFakeSql, JsonValue, pgError } from './fake-sql';
import { context, ID, IP_HASH, IP_SALT, OTHER_ID, request } from './helpers';

const mockSql = createFakeSql();
jest.mock('../utils/db', () => ({ db: () => mockSql.sql }));
jest.mock('../utils/turnstile', () => ({ verifyTurnstile: jest.fn() }));

const verifyTurnstileMock = verifyTurnstile as jest.Mock;

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

// unrounded number to check that the stored sound is normalized
const data = { ...presetDataSchema.parse({}), filter: { a: true, cut: 1234.5678 } };
const EDIT_TOKEN = 'e'.repeat(43);

const Q = {
  findByHash: /^SELECT id, name FROM presets WHERE hash =/,
  nameTaken: /WHERE lower\(name\) = lower/,
  countPresets: /FROM "presets" WHERE ip_hash/,
  countReports: /FROM "reports" WHERE ip_hash/,
  insert: /^INSERT INTO presets/,
  editable: /^SELECT edit_token_hash/,
  update: /^UPDATE presets SET name/,
  opened: /^UPDATE presets SET author_opened_at/,
  get: /^SELECT id, name, data, created_at/,
  top: /WHERE \(p\.featured OR s\.popular\)/,
  list: /AS "cursorKey" FROM presets p LEFT JOIN preset_scores/,
  exists: /^SELECT id FROM presets WHERE id/,
  insertReport: /^INSERT INTO reports/,
  hide: /^UPDATE presets SET hidden/,
};

const call = async (method: string, path: string, body?: unknown) => {
  const response = await handler(request(method, path, body), context);
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : undefined };
};

const decodeCursor = (cursor: string) => JSON.parse(Buffer.from(cursor, 'base64url').toString());
const encodeCursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

beforeEach(() => {
  mockSql.reset();
  mockSql.respond(Q.countPresets, [{ count: 0 }]);
  mockSql.respond(Q.countReports, [{ count: 0 }]);
  verifyTurnstileMock.mockReset().mockResolvedValue(true);
  process.env.IP_HASH_SALT = IP_SALT;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.REPORT_HIDE_THRESHOLD;
});

it('is routed to /api/presets', () => {
  expect(config.path).toEqual(['/api/presets', '/api/presets/*']);
});

describe('routing', () => {
  it.each([`/api/presets/${ID}/report/more`, `/api/presets/${ID}/unknown`, '/api/presets/top/x/y'])(
    '404 for %s',
    async (path) => {
      const { status, body } = await call('GET', path);
      expect(status).toBe(404);
      expect(body).toEqual({ error: 'Not found' });
      expect(mockSql.queries).toHaveLength(0);
    }
  );

  it.each([
    ['DELETE', '/api/presets'],
    ['PUT', '/api/presets'],
    ['POST', '/api/presets/top'],
    ['POST', '/api/presets/name-available?name=a'],
    ['POST', `/api/presets/${ID}`],
    ['DELETE', `/api/presets/${ID}`],
    ['GET', `/api/presets/${ID}/report`],
    ['GET', `/api/presets/${ID}/opened`],
  ])('405 for %s %s', async (method, path) => {
    const { status, body } = await call(method, path);
    expect(status).toBe(405);
    expect(body).toEqual({ error: 'Method not allowed' });
  });

  it('accepts a trailing slash', async () => {
    const { status } = await call('GET', '/api/presets/');
    expect(status).toBe(200);
    expect(mockSql.find(Q.list)).toHaveLength(1);
  });

  it('hides database errors behind 500', async () => {
    mockSql.respond(Q.get, new Error('connection refused'));
    const { status, body } = await call('GET', `/api/presets/${ID}`);
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'Internal error' });
  });
});

describe('POST /api/presets', () => {
  const save = (body: unknown = { name: 'My Pad', data, turnstileToken: 'turnstile' }) =>
    call('POST', '/api/presets', body);

  it('creates a preset and returns the edit token once', async () => {
    mockSql.respond(Q.insert, [{ id: ID, name: 'My Pad' }]);
    const { status, body } = await save({ name: '  My   Pad ', data, turnstileToken: 'turnstile' });

    expect(status).toBe(201);
    expect(body).toEqual({ id: ID, name: 'My Pad', existed: false, editToken: expect.any(String) });
    expect(body.editToken.length).toBeGreaterThanOrEqual(40);
    expect(verifyTurnstileMock).toHaveBeenCalledWith('turnstile', '1.2.3.4');

    const [insert] = mockSql.find(Q.insert);
    const [hash, name, stored, ipHash, editTokenHash] = insert.values;
    expect(hash).toBe(presetHash(data));
    expect(name).toBe('My Pad');
    expect((stored as JsonValue).json).toMatchObject({ filter: { a: true, cut: 1235, t: 'lowpass' } });
    expect(ipHash).toBe(IP_HASH);
    expect(editTokenHash).toBe(sha256(body.editToken));
    expect(insert.values).not.toContain(body.editToken);
    expect(insert.values).not.toContain('1.2.3.4');
  });

  it('gives every preset a new edit token', async () => {
    mockSql.respond(Q.insert, [{ id: ID, name: 'My Pad' }]);
    const first = await save();
    const second = await save();
    expect(first.body.editToken).not.toBe(second.body.editToken);
  });

  it('returns an existing preset with the same sound without the captcha', async () => {
    mockSql.respond(Q.findByHash, [{ id: OTHER_ID, name: 'Old name' }]);
    const { status, body } = await save();
    expect(status).toBe(200);
    expect(body).toEqual({ id: OTHER_ID, name: 'Old name', existed: true });
    expect(mockSql.find(Q.findByHash)[0].values).toEqual([presetHash(data)]);
    expect(verifyTurnstileMock).not.toHaveBeenCalled();
    expect(mockSql.find(Q.insert)).toHaveLength(0);
  });

  it('returns the existing preset even when the name and the limit are taken', async () => {
    mockSql.respond(Q.findByHash, [{ id: OTHER_ID, name: 'Old name' }]);
    mockSql.respond(Q.nameTaken, [{ '?column?': 1 }]);
    mockSql.respond(Q.countPresets, [{ count: 100 }]);
    expect((await save()).status).toBe(200);
  });

  it('rejects a taken name with 409', async () => {
    mockSql.respond(Q.nameTaken, [{ '?column?': 1 }]);
    const { status, body } = await save();
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'Name “My Pad” is already taken' });
    expect(mockSql.find(Q.nameTaken)[0].values).toEqual(['My Pad']);
    expect(verifyTurnstileMock).not.toHaveBeenCalled();
  });

  it('limits saves to 5 per hour per IP', async () => {
    mockSql.respond(Q.countPresets, [{ count: 5 }]);
    const { status } = await save();
    expect(status).toBe(429);
    expect(mockSql.find(Q.countPresets)[0].values).toEqual([IP_HASH]);
    expect(verifyTurnstileMock).not.toHaveBeenCalled();

    mockSql.respond(Q.countPresets, [{ count: 4 }]);
    mockSql.respond(Q.insert, [{ id: ID, name: 'My Pad' }]);
    expect((await save()).status).toBe(201);
  });

  it('rejects a failed captcha with 403', async () => {
    verifyTurnstileMock.mockResolvedValue(false);
    const { status, body } = await save();
    expect(status).toBe(403);
    expect(body).toEqual({ error: 'Captcha check failed, try again' });
    expect(mockSql.find(Q.insert)).toHaveLength(0);
  });

  it('returns the preset saved by a concurrent request with the same sound', async () => {
    let lookups = 0;
    mockSql.respond(Q.findByHash, () => (lookups++ === 0 ? [] : [{ id: OTHER_ID, name: 'Concurrent' }]));
    const { status, body } = await save();
    expect(status).toBe(200);
    expect(body).toEqual({ id: OTHER_ID, name: 'Concurrent', existed: true });
    expect(body.editToken).toBeUndefined();
  });

  it('rejects a name taken by a concurrent request with 409', async () => {
    mockSql.respond(Q.insert, pgError('23505', 'presets_name_key'));
    const { status, body } = await save();
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'Name “My Pad” is already taken' });
  });

  it('fails with 500 on other database errors', async () => {
    mockSql.respond(Q.insert, pgError('23505', 'some_other_key'));
    expect((await save()).status).toBe(500);
  });

  it.each([
    ['invalid JSON', '{'],
    ['a missing captcha token', { name: 'My Pad', data }],
    ['an empty name', { name: '   ', data, turnstileToken: 't' }],
    ['a too long name', { name: 'x'.repeat(PRESET_NAME_MAX_LENGTH + 1), data, turnstileToken: 't' }],
    ['out of range data', { name: 'My Pad', data: { ...data, v: { max: 100 } }, turnstileToken: 't' }],
  ])('rejects %s with 400', async (_, body) => {
    const { status } = await save(body);
    expect(status).toBe(400);
    expect(mockSql.queries).toHaveLength(0);
  });

  it('rejects profane names with 400', async () => {
    const { status, body } = await save({ name: 'fuck', data, turnstileToken: 't' });
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'Please choose another name' });
  });

  it('rejects bodies over 20 KB with 413', async () => {
    const { status } = await save({ name: 'My Pad', data, turnstileToken: 't', junk: 'x'.repeat(20 * 1024) });
    expect(status).toBe(413);
  });
});

describe('PUT /api/presets/:id', () => {
  const update = (body: unknown = { name: 'New name', data, editToken: EDIT_TOKEN }, id = ID) =>
    call('PUT', `/api/presets/${id}`, body);
  const editable = (row: Partial<{ editTokenHash: string | null; hidden: boolean; throttled: boolean }>) =>
    mockSql.respond(Q.editable, [
      { editTokenHash: sha256(EDIT_TOKEN), hidden: false, throttled: false, ...row },
    ]);

  it('overwrites the name and the sound', async () => {
    editable({});
    const { status, body } = await update({ name: ' New   name ', data, editToken: EDIT_TOKEN });
    expect(status).toBe(200);
    expect(body).toEqual({ id: ID, name: 'New name' });

    expect(mockSql.find(Q.editable)[0].values).toEqual([5, ID]);
    const [query] = mockSql.find(Q.update);
    const [name, stored, hash, id] = query.values;
    expect(name).toBe('New name');
    expect((stored as JsonValue).json).toMatchObject({ filter: { cut: 1235 } });
    expect(hash).toBe(presetHash(data));
    expect(id).toBe(ID);
    expect(query.text).toContain('updated_at = now()');
  });

  it('returns 404 for an invalid id without a query', async () => {
    const { status } = await update(undefined, 'not-a-uuid');
    expect(status).toBe(404);
    expect(mockSql.queries).toHaveLength(0);
  });

  it('returns 404 for a missing or hidden preset', async () => {
    expect((await update()).status).toBe(404);
    editable({ hidden: true });
    expect((await update()).status).toBe(404);
    expect(mockSql.find(Q.update)).toHaveLength(0);
  });

  it.each([
    ['a preset without a token', null],
    ['a wrong token', sha256('another token value')],
    ['a malformed stored hash', 'short'],
  ])('rejects %s with 403', async (_, editTokenHash) => {
    editable({ editTokenHash });
    const { status, body } = await update();
    expect(status).toBe(403);
    expect(body).toEqual({ error: 'You can only edit presets saved from this browser' });
    expect(mockSql.find(Q.update)).toHaveLength(0);
  });

  it('allows one update per 5 seconds', async () => {
    editable({ throttled: true });
    expect((await update()).status).toBe(429);
    expect(mockSql.find(Q.update)).toHaveLength(0);
  });

  it('rejects a name of another preset with 409', async () => {
    editable({});
    mockSql.respond(Q.update, pgError('23505', 'presets_name_key'));
    const { status, body } = await update();
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'Name “New name” is already taken' });
  });

  it('rejects a sound of another preset with 409 and returns that preset', async () => {
    editable({});
    mockSql.respond(Q.update, pgError('23505', 'presets_hash_key'));
    mockSql.respond(Q.findByHash, [{ id: OTHER_ID, name: 'Other' }]);
    const { status, body } = await update();
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'This sound is already saved as “Other”', id: OTHER_ID, name: 'Other' });
    expect(mockSql.find(Q.findByHash)[0].values).toEqual([presetHash(data)]);
  });

  it('fails with 500 on other database errors', async () => {
    editable({});
    mockSql.respond(Q.update, new Error('deadlock'));
    expect((await update()).status).toBe(500);
  });

  it.each([
    ['invalid JSON', '{'],
    ['a missing token', { name: 'New name', data }],
    ['a short token', { name: 'New name', data, editToken: 'short' }],
    ['a profane name', { name: 'fuck', data, editToken: EDIT_TOKEN }],
  ])('rejects %s with 400', async (_, body) => {
    editable({});
    expect((await update(body)).status).toBe(400);
    expect(mockSql.find(Q.update)).toHaveLength(0);
  });
});

describe('POST /api/presets/:id/opened', () => {
  const open = (body: unknown = { editToken: EDIT_TOKEN }, id = ID) =>
    call('POST', `/api/presets/${id}/opened`, body);

  it('marks a visible preset with this edit token as opened by its author, once a day', async () => {
    const { status, body } = await open();
    expect(status).toBe(204);
    expect(body).toBeUndefined();

    expect(mockSql.queries).toHaveLength(1);
    const [query] = mockSql.find(Q.opened);
    expect(query.text).toBe(
      'UPDATE presets SET author_opened_at = now() WHERE id = $1 AND edit_token_hash = $2 AND NOT hidden ' +
        "AND (author_opened_at IS NULL OR author_opened_at < now() - interval '1 day')"
    );
    expect(query.values).toEqual([ID, sha256(EDIT_TOKEN)]);
  });

  it('returns 404 for an invalid id without a query', async () => {
    expect((await open(undefined, 'not-a-uuid')).status).toBe(404);
    expect(mockSql.queries).toHaveLength(0);
  });

  it.each([
    ['invalid JSON', '{'],
    ['a missing token', {}],
    ['a short token', { editToken: 'short' }],
  ])('rejects %s with 400 without a query', async (_, body) => {
    const response = await open(body);
    expect(response.status).toBe(400);
    expect(mockSql.queries).toHaveLength(0);
  });

  it('fails with 500 on database errors', async () => {
    mockSql.respond(Q.opened, new Error('connection refused'));
    expect((await open()).status).toBe(500);
  });
});

describe('GET /api/presets/:id', () => {
  it('returns a visible preset without caching', async () => {
    const preset = { id: ID, name: 'Pad', data, createdAt: '2026-01-01T00:00:00Z' };
    mockSql.respond(Q.get, [preset]);
    const { status, body, headers } = await call('GET', `/api/presets/${ID}`);
    expect(status).toBe(200);
    expect(body).toEqual(preset);
    expect(headers.get('Cache-Control')).toBe('no-store');

    const [query] = mockSql.find(Q.get);
    expect(query.values).toEqual([ID]);
    expect(query.text).toContain('AND NOT hidden');
  });

  it('returns 404 for a missing preset', async () => {
    const { status, body } = await call('GET', `/api/presets/${ID}`);
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Preset not found' });
  });

  it('returns 404 for an invalid id without a query', async () => {
    expect((await call('GET', '/api/presets/123')).status).toBe(404);
    expect(mockSql.queries).toHaveLength(0);
  });
});

describe('GET /api/presets/name-available', () => {
  const check = (name?: string) =>
    call(
      'GET',
      `/api/presets/name-available${name === undefined ? '' : `?name=${encodeURIComponent(name)}`}`
    );

  it('reports a free name', async () => {
    const { status, body } = await check('Pad');
    expect(status).toBe(200);
    expect(body).toEqual({ available: true });
  });

  it('reports a taken name', async () => {
    mockSql.respond(Q.nameTaken, [{ '?column?': 1 }]);
    expect((await check('Pad')).body).toEqual({ available: false });
  });

  it('normalizes the name before the lookup', async () => {
    await check('  My   Pad ');
    expect(mockSql.find(Q.nameTaken)[0].values).toEqual(['My Pad']);
  });

  it.each([undefined, '', '   ', 'x'.repeat(PRESET_NAME_MAX_LENGTH + 1)])(
    'rejects %p with 400',
    async (name) => {
      const { status, body } = await check(name);
      expect(status).toBe(400);
      expect(body).toEqual({ error: 'Invalid name' });
      expect(mockSql.queries).toHaveLength(0);
    }
  );
});

describe('GET /api/presets/top', () => {
  const items = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, i) => ({
      id: uuid(i + offset),
      name: `P${i + offset}`,
      uniqueUsers: 3,
    }));

  it('returns at most 50 presets in one query, cached for 5 minutes', async () => {
    mockSql.respond(Q.top, items(50));
    const { status, body, headers } = await call('GET', '/api/presets/top');
    expect(status).toBe(200);
    expect(body).toEqual(items(50));
    expect(headers.get('Cache-Control')).toBe('public, s-maxage=300');
    expect(mockSql.queries).toHaveLength(1);
    expect(mockSql.find(Q.top)[0].values).toEqual([50]);
  });

  it('takes every visible featured preset and the visible presets above the popular threshold', async () => {
    await call('GET', '/api/presets/top');
    const [query] = mockSql.find(Q.top);
    expect(query.text).toContain('FROM presets p LEFT JOIN preset_scores s ON s.preset_id = p.id');
    expect(query.text).toContain('WHERE (p.featured OR s.popular) AND NOT p.hidden');
  });

  it('puts featured presets first whatever their score, the rest by score', async () => {
    await call('GET', '/api/presets/top');
    const [query] = mockSql.find(Q.top);
    expect(query.text).toContain(
      'ORDER BY p.featured DESC, s.score DESC NULLS LAST, p.created_at DESC, p.id DESC'
    );
  });

  it('shows unique users of featured presets below the popular threshold, 0 without a score', async () => {
    await call('GET', '/api/presets/top');
    const [query] = mockSql.find(Q.top);
    expect(query.text).toContain('COALESCE(s.unique_users, 0) AS "uniqueUsers"');
  });

  it('returns featured presets on a cold start', async () => {
    mockSql.respond(Q.top, items(1));
    expect((await call('GET', '/api/presets/top')).body).toEqual(items(1));
  });
});

describe('GET /api/presets', () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: uuid(i),
      name: `P${i}`,
      uniqueUsers: i,
      cursorKey: `key-${i}`,
    }));
  const list = (query = '') => call('GET', `/api/presets${query}`);

  it('returns the newest visible presets by default', async () => {
    mockSql.respond(Q.list, rows(2));
    const { status, body, headers } = await list();
    expect(status).toBe(200);
    expect(body).toEqual({
      items: [
        { id: uuid(0), name: 'P0', uniqueUsers: 0 },
        { id: uuid(1), name: 'P1', uniqueUsers: 1 },
      ],
      nextCursor: null,
    });
    expect(headers.get('Cache-Control')).toBe('public, s-maxage=60');

    const [query] = mockSql.find(Q.list);
    expect(query.text).toContain('p.created_at::text AS "cursorKey"');
    expect(query.text).toContain('WHERE NOT p.hidden');
    expect(query.text).toContain('ORDER BY p.created_at DESC, p.id DESC');
    expect(query.text).not.toContain('ILIKE');
    expect(query.values).toEqual([31]);
  });

  it('returns a cursor of the last item when there are more rows', async () => {
    mockSql.respond(Q.list, rows(31));
    const { body } = await list();
    expect(body.items).toHaveLength(30);
    expect(body.items[29]).toEqual({ id: uuid(29), name: 'P29', uniqueUsers: 29 });
    expect(decodeCursor(body.nextCursor)).toEqual(['key-29', uuid(29)]);
  });

  it('returns no cursor for exactly one page', async () => {
    mockSql.respond(Q.list, rows(30));
    expect((await list()).body.nextCursor).toBeNull();
  });

  it.each([
    [
      'new',
      'p.created_at::text',
      '(p.created_at, p.id) < ($1::timestamptz, $2::uuid)',
      'p.created_at DESC, p.id DESC',
    ],
    ['name', 'p.name', '(p.name, p.id) > ($1, $2::uuid)', 'p.name, p.id'],
    [
      'popular',
      'COALESCE(s.score, 0)::text',
      '(COALESCE(s.score, 0), p.id) < ($1::float8, $2::uuid)',
      'COALESCE(s.score, 0) DESC, p.id DESC',
    ],
  ])('continues %s sort after the cursor', async (sort, key, after, order) => {
    mockSql.respond(Q.list, rows(31));
    const first = await list(`?sort=${sort}`);
    const [firstQuery] = mockSql.find(Q.list);
    expect(firstQuery.text).toContain(`${key} AS "cursorKey"`);
    expect(firstQuery.text).toContain(`ORDER BY ${order}`);
    expect(firstQuery.text).not.toContain(after);

    await list(`?sort=${sort}&cursor=${first.body.nextCursor}`);
    const [, nextQuery] = mockSql.find(Q.list);
    expect(nextQuery.text).toContain(`AND ${after}`);
    expect(nextQuery.values).toEqual(['key-29', uuid(29), 31]);
  });

  it('searches by name with escaped LIKE wildcards and no caching', async () => {
    const { headers } = await list(`?q=${encodeURIComponent(' 50%_off\\ ')}`);
    expect(headers.get('Cache-Control')).toBe('no-store');
    const [query] = mockSql.find(Q.list);
    expect(query.text).toContain('AND p.name ILIKE $1');
    expect(query.values).toEqual(['%50\\%\\_off\\\\%', 31]);
  });

  it('ignores a blank search', async () => {
    await list('?q=%20%20');
    expect(mockSql.find(Q.list)[0].text).not.toContain('ILIKE');
  });

  it.each([
    ['an unknown sort', '?sort=random'],
    ['a too long search', `?q=${'x'.repeat(PRESET_NAME_MAX_LENGTH + 1)}`],
  ])('rejects %s with 400', async (_, query) => {
    const { status, body } = await list(query);
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'Invalid query' });
  });

  it.each([
    ['garbage', 'not-a-cursor'],
    ['a non-uuid id', encodeCursor(['key', 'abc'])],
    ['a non-string key', encodeCursor([1, ID])],
    ['not an array', encodeCursor({ key: 'a' })],
  ])('rejects a cursor with %s with 400', async (_, cursor) => {
    const { status, body } = await list(`?cursor=${cursor}`);
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'Invalid cursor' });
    expect(mockSql.queries).toHaveLength(0);
  });
});

describe('POST /api/presets/:id/report', () => {
  const report = (id = ID) => call('POST', `/api/presets/${id}/report`);

  it('stores the report and hides the preset over the threshold', async () => {
    mockSql.respond(Q.exists, [{ id: ID }]);
    const { status, body } = await report();
    expect(status).toBe(204);
    expect(body).toBeUndefined();

    expect(mockSql.find(Q.countReports)[0].values).toEqual([IP_HASH]);
    const [insert] = mockSql.find(Q.insertReport);
    expect(insert.values).toEqual([ID, IP_HASH]);
    expect(insert.text).toContain('ON CONFLICT DO NOTHING');
    const [hide] = mockSql.find(Q.hide);
    expect(hide.values).toEqual([ID, ID, 5]);
    expect(hide.text).toContain('AND NOT hidden');
  });

  it('takes the threshold from REPORT_HIDE_THRESHOLD', async () => {
    process.env.REPORT_HIDE_THRESHOLD = '3';
    mockSql.respond(Q.exists, [{ id: ID }]);
    await report();
    expect(mockSql.find(Q.hide)[0].values).toEqual([ID, ID, 3]);
  });

  it('limits reports to 20 per hour per IP', async () => {
    mockSql.respond(Q.countReports, [{ count: 20 }]);
    mockSql.respond(Q.exists, [{ id: ID }]);
    expect((await report()).status).toBe(429);
    expect(mockSql.find(Q.insertReport)).toHaveLength(0);
  });

  it('returns 404 for a missing preset', async () => {
    expect((await report()).status).toBe(404);
    expect(mockSql.find(Q.insertReport)).toHaveLength(0);
  });

  it('returns 404 for an invalid id without a query', async () => {
    expect((await report('nope')).status).toBe(404);
    expect(mockSql.queries).toHaveLength(0);
  });
});
