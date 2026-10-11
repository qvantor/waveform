import type { Config, Context } from '@netlify/functions';
import { USAGE_MAX_SECONDS, usageRequestSchema } from '../../libs/preset-schema/src';
import { db } from '../utils/db';
import { empty, errorResponse, getIpHash, HttpError, readJson, sha256 } from '../utils/http';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_CLIENTS_PER_IP = 3;
const MAX_SECONDS_PER_DAY = 1800;

export default async (req: Request, context: Context) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const parsed = usageRequestSchema.safeParse(await readJson(req, MAX_BODY_BYTES));
    if (!parsed.success) throw new HttpError(400, 'Invalid usage batch');

    const ipHash = getIpHash(context);
    const clientHash = sha256(parsed.data.clientId + ipHash);

    const seconds = new Map<string, number>();
    for (const item of parsed.data.items)
      seconds.set(
        item.presetId,
        Math.min((seconds.get(item.presetId) ?? 0) + item.seconds, USAGE_MAX_SECONDS)
      );

    // a new client is not counted if the preset already has MAX_CLIENTS_PER_IP clients from this IP today
    const sql = db();
    await sql`
      INSERT INTO usage_daily (preset_id, client_hash, ip_hash, day, seconds)
      SELECT p.id, ${clientHash}, ${ipHash}, current_date, i.seconds
      FROM unnest(${[...seconds.keys()]}::uuid[], ${[...seconds.values()]}::int[]) AS i(preset_id, seconds)
      JOIN presets p ON p.id = i.preset_id AND NOT p.hidden
      WHERE EXISTS (
          SELECT 1 FROM usage_daily u
          WHERE u.preset_id = p.id AND u.client_hash = ${clientHash} AND u.day = current_date
        )
        OR (
          SELECT count(DISTINCT u.client_hash) FROM usage_daily u
          WHERE u.preset_id = p.id AND u.ip_hash = ${ipHash} AND u.day = current_date
        ) < ${MAX_CLIENTS_PER_IP}
      ON CONFLICT (preset_id, client_hash, day)
      DO UPDATE SET seconds = LEAST(usage_daily.seconds + EXCLUDED.seconds, ${MAX_SECONDS_PER_DAY})`;
    return empty();
  } catch (error) {
    return errorResponse(error);
  }
};

export const config: Config = {
  path: '/api/usage',
};
