import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config, Context } from '@netlify/functions';
import type postgres from 'postgres';
import type { z } from 'zod';
import {
  isProfane,
  listPresetsQuerySchema,
  normalizePreset,
  presetHash,
  presetIdSchema,
  presetNameSchema,
  presetOpenedRequestSchema,
  savePresetRequestSchema,
  updatePresetRequestSchema,
} from '../../libs/preset-schema/src';
import type {
  NameAvailableResponse,
  Preset,
  PresetListItem,
  PresetSort,
  PresetsPage,
  SavePresetResponse,
  UpdatePresetResponse,
} from '../../libs/preset-schema/src';
import { db } from '../utils/db';
import { envNumber } from '../utils/env';
import { empty, errorResponse, getIpHash, HttpError, json, readJson, sha256 } from '../utils/http';
import { verifyTurnstile } from '../utils/turnstile';

const MAX_BODY_BYTES = 20 * 1024;
const SAVES_PER_HOUR = 5;
const REPORTS_PER_HOUR = 20;
const TOP_SIZE = 50;
const PAGE_SIZE = 30;
const UPDATE_INTERVAL_SECONDS = 5;

const isUniqueViolation = (error: unknown, constraint: string) => {
  const { code, constraint_name } = error as { code?: string; constraint_name?: string };
  return code === '23505' && constraint_name === constraint;
};

const nameTakenError = (name: string) => new HttpError(409, `Name “${name}” is already taken`);

// names are unique case-insensitively, hidden presets keep their names too
const isNameTaken = async (name: string) =>
  (await db()`SELECT 1 FROM presets WHERE lower(name) = lower(${name})`).length > 0;

const findByHash = async (hash: string) =>
  (await db()<{ id: string; name: string }[]>`SELECT id, name FROM presets WHERE hash = ${hash}`)[0];

const countLastHour = async (table: 'presets' | 'reports', ipHash: string) => {
  const sql = db();
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM ${sql(table)}
    WHERE ip_hash = ${ipHash} AND created_at > now() - interval '1 hour'`;
  return count;
};

const parsePresetBody = async <T extends { name: string; data: unknown }>(
  req: Request,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
) => {
  const parsed = schema.safeParse(await readJson(req, MAX_BODY_BYTES));
  if (!parsed.success) throw new HttpError(400, 'Invalid preset');
  if (isProfane(parsed.data.name)) throw new HttpError(400, 'Please choose another name');
  const data = normalizePreset(parsed.data.data);
  return { ...parsed.data, data, hash: presetHash(data) };
};

const parseId = (id: string) => {
  const parsed = presetIdSchema.safeParse(id);
  if (!parsed.success) throw new HttpError(404, 'Preset not found');
  return parsed.data;
};

const savePreset = async (req: Request, context: Context) => {
  const { name, turnstileToken, data, hash } = await parsePresetBody(req, savePresetRequestSchema);

  const sql = db();
  const ipHash = getIpHash(context);
  const [existing, nameTaken, count] = await Promise.all([
    findByHash(hash),
    isNameTaken(name),
    countLastHour('presets', ipHash),
  ]);
  // the same sound is returned without spending the captcha, its name is kept
  if (existing) return json({ ...existing, existed: true } as SavePresetResponse);
  if (nameTaken) throw nameTakenError(name);
  if (count >= SAVES_PER_HOUR) throw new HttpError(429, 'Too many presets saved, try again later');

  if (!(await verifyTurnstile(turnstileToken, context.ip)))
    throw new HttpError(403, 'Captcha check failed, try again');

  // the author gets the token once, only its hash is stored
  const editToken = randomBytes(32).toString('base64url');
  try {
    const [inserted] = await sql<{ id: string; name: string }[]>`
      INSERT INTO presets (hash, name, data, ip_hash, edit_token_hash)
      VALUES (${hash}, ${name}, ${sql.json(data)}, ${ipHash}, ${sha256(editToken)})
      ON CONFLICT (hash) DO NOTHING
      RETURNING id, name`;
    if (inserted) return json({ ...inserted, existed: false, editToken } as SavePresetResponse, 201);
  } catch (error) {
    // checks above can race with a concurrent save
    if (isUniqueViolation(error, 'presets_name_key')) throw nameTakenError(name);
    throw error;
  }
  return json({ ...(await findByHash(hash)), existed: true } as SavePresetResponse);
};

const isSameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// overwrites sound and name, links to the preset play the updated sound
const updatePreset = async (id: string, req: Request) => {
  const presetId = parseId(id);
  const { name, editToken, data, hash } = await parsePresetBody(req, updatePresetRequestSchema);

  const sql = db();
  const [preset] = await sql<{ editTokenHash: string | null; hidden: boolean; throttled: boolean }[]>`
    SELECT edit_token_hash AS "editTokenHash", hidden,
      COALESCE(updated_at > now() - make_interval(secs => ${UPDATE_INTERVAL_SECONDS}), false) AS throttled
    FROM presets WHERE id = ${presetId}`;
  if (!preset || preset.hidden) throw new HttpError(404, 'Preset not found');
  if (!preset.editTokenHash || !isSameHash(preset.editTokenHash, sha256(editToken)))
    throw new HttpError(403, 'You can only edit presets saved from this browser');
  if (preset.throttled) throw new HttpError(429, 'Too many updates, try again in a few seconds');

  try {
    await sql`
      UPDATE presets SET name = ${name}, data = ${sql.json(data)}, hash = ${hash}, updated_at = now()
      WHERE id = ${presetId}`;
  } catch (error) {
    // renaming own preset (e.g. changing case) is the same row, so it never conflicts
    if (isUniqueViolation(error, 'presets_name_key')) throw nameTakenError(name);
    if (!isUniqueViolation(error, 'presets_hash_key')) throw error;
    const existing = await findByHash(hash);
    return json({ error: `This sound is already saved as “${existing?.name}”`, ...existing }, 409);
  }
  return json({ id: presetId, name } as UpdatePresetResponse);
};

// the author opened the preset (the client sends the edit token it keeps): cleanup counts the 90 days of an
// unqualified preset from then. At most one write a day; a wrong token, a missing or hidden preset change nothing
const markOpened = async (id: string, req: Request) => {
  const presetId = parseId(id);
  const parsed = presetOpenedRequestSchema.safeParse(await readJson(req, MAX_BODY_BYTES));
  if (!parsed.success) throw new HttpError(400, 'Invalid edit token');
  await db()`
    UPDATE presets SET author_opened_at = now()
    WHERE id = ${presetId} AND edit_token_hash = ${sha256(parsed.data.editToken)} AND NOT hidden
      AND (author_opened_at IS NULL OR author_opened_at < now() - interval '1 day')`;
  return empty();
};

const getNameAvailable = async (url: URL) => {
  const parsed = presetNameSchema.safeParse(url.searchParams.get('name') ?? '');
  if (!parsed.success) throw new HttpError(400, 'Invalid name');
  return json({ available: !(await isNameTaken(parsed.data)) } as NameAvailableResponse);
};

const getPreset = async (id: string) => {
  const [preset] = await db()<Preset[]>`
    SELECT id, name, data, created_at AS "createdAt" FROM presets
    WHERE id = ${parseId(id)} AND NOT hidden`;
  if (!preset) throw new HttpError(404, 'Preset not found');
  // not cached: the author can overwrite the preset
  return json(preset);
};

// every featured preset (curated) comes first, whatever its score, the rest are popular presets by score
const getTop = async () => {
  const top = await db()<PresetListItem[]>`
    SELECT p.id, p.name, COALESCE(s.unique_users, 0) AS "uniqueUsers"
    FROM presets p LEFT JOIN preset_scores s ON s.preset_id = p.id
    WHERE (p.featured OR s.popular) AND NOT p.hidden
    ORDER BY p.featured DESC, s.score DESC NULLS LAST, p.created_at DESC, p.id DESC
    LIMIT ${TOP_SIZE}`;
  return json(top, 200, { 'Cache-Control': 'public, s-maxage=300' });
};

// keyset pagination, cursor is an opaque [sort key as text, id] pair
const encodeCursor = (key: string, id: string) =>
  Buffer.from(JSON.stringify([key, id])).toString('base64url');
const decodeCursor = (cursor: string): [string, string] => {
  try {
    const [key, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (typeof key !== 'string' || !presetIdSchema.safeParse(id).success) throw new Error();
    return [key, id];
  } catch (e) {
    throw new HttpError(400, 'Invalid cursor');
  }
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

const listPresets = async (url: URL) => {
  const parsed = listPresetsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw new HttpError(400, 'Invalid query');
  const { q, sort, cursor } = parsed.data;
  const sql = db();
  const after = cursor ? decodeCursor(cursor) : null;

  const orders: Record<PresetSort, Record<'key' | 'after' | 'order', postgres.Fragment>> = {
    new: {
      key: sql`p.created_at::text`,
      after: after ? sql`AND (p.created_at, p.id) < (${after[0]}::timestamptz, ${after[1]}::uuid)` : sql``,
      order: sql`p.created_at DESC, p.id DESC`,
    },
    name: {
      key: sql`p.name`,
      after: after ? sql`AND (p.name, p.id) > (${after[0]}, ${after[1]}::uuid)` : sql``,
      order: sql`p.name, p.id`,
    },
    popular: {
      key: sql`COALESCE(s.score, 0)::text`,
      after: after ? sql`AND (COALESCE(s.score, 0), p.id) < (${after[0]}::float8, ${after[1]}::uuid)` : sql``,
      order: sql`COALESCE(s.score, 0) DESC, p.id DESC`,
    },
  };
  const { key, after: afterCondition, order } = orders[sort];

  const rows = await sql<(PresetListItem & { cursorKey: string })[]>`
    SELECT p.id, p.name, COALESCE(s.unique_users, 0) AS "uniqueUsers", ${key} AS "cursorKey"
    FROM presets p LEFT JOIN preset_scores s ON s.preset_id = p.id
    WHERE NOT p.hidden
      ${q ? sql`AND p.name ILIKE ${'%' + escapeLike(q) + '%'}` : sql``}
      ${afterCondition}
    ORDER BY ${order}
    LIMIT ${PAGE_SIZE + 1}`;

  const items = rows.slice(0, PAGE_SIZE).map(({ id, name, uniqueUsers }) => ({ id, name, uniqueUsers }));
  const last = rows[PAGE_SIZE - 1];
  const page: PresetsPage = {
    items,
    nextCursor: rows.length > PAGE_SIZE ? encodeCursor(last.cursorKey, last.id) : null,
  };
  return json(page, 200, { 'Cache-Control': q ? 'no-store' : 'public, s-maxage=60' });
};

const reportPreset = async (id: string, context: Context) => {
  const presetId = parseId(id);
  const sql = db();
  const ipHash = getIpHash(context);
  if ((await countLastHour('reports', ipHash)) >= REPORTS_PER_HOUR)
    throw new HttpError(429, 'Too many reports, try again later');

  const [preset] = await sql`SELECT id FROM presets WHERE id = ${presetId}`;
  if (!preset) throw new HttpError(404, 'Preset not found');

  await sql`INSERT INTO reports (preset_id, ip_hash) VALUES (${presetId}, ${ipHash}) ON CONFLICT DO NOTHING`;
  await sql`
    UPDATE presets SET hidden = true
    WHERE id = ${presetId} AND NOT hidden
      AND (SELECT count(*) FROM reports WHERE preset_id = ${presetId}) >= ${envNumber(
    'REPORT_HIDE_THRESHOLD',
    5
  )}`;
  return empty();
};

export default async (req: Request, context: Context) => {
  try {
    const url = new URL(req.url);
    const [id, action, ...rest] = url.pathname
      .replace(/^\/api\/presets\/?/, '')
      .split('/')
      .filter(Boolean);
    if (rest.length > 0) throw new HttpError(404, 'Not found');

    if (!id) {
      if (req.method === 'GET') return await listPresets(url);
      if (req.method === 'POST') return await savePreset(req, context);
    } else if (id === 'top' && !action) {
      if (req.method === 'GET') return await getTop();
    } else if (id === 'name-available' && !action) {
      if (req.method === 'GET') return await getNameAvailable(url);
    } else if (!action) {
      if (req.method === 'GET') return await getPreset(id);
      if (req.method === 'PUT') return await updatePreset(id, req);
    } else if (action === 'report') {
      if (req.method === 'POST') return await reportPreset(id, context);
    } else if (action === 'opened') {
      if (req.method === 'POST') return await markOpened(id, req);
    } else throw new HttpError(404, 'Not found');
    throw new HttpError(405, 'Method not allowed');
  } catch (error) {
    return errorResponse(error);
  }
};

export const config: Config = {
  path: ['/api/presets', '/api/presets/*'],
};
