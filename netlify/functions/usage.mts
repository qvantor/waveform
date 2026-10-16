import type { Config, Context } from '@netlify/functions';
import { usageRequestSchema } from '../../libs/preset-schema/src';
import { db } from '../utils/db';
import { empty, errorResponse, getIpHash, HttpError, readJson } from '../utils/http';

const MAX_BODY_BYTES = 4 * 1024;

// a listen or a stay (played the preset for USAGE_LISTEN_SECONDS or USAGE_STAY_SECONDS without switching to another
// one, see recompute-scores), the client sends each once a preset is opened. A listener and preset have one row with
// the days of the last listen and stay, each written at most once a day; a stay is a listen too (the listen request
// may have failed). Listens on hidden presets and on the author's own ones (the IP it was saved from) are not stored
export default async (req: Request, context: Context) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const parsed = usageRequestSchema.safeParse(await readJson(req, MAX_BODY_BYTES));
    if (!parsed.success) throw new HttpError(400, 'Invalid usage');

    const sql = db();
    const ipHash = getIpHash(context);
    const stay = parsed.data.event === 'stay';
    await sql`
      INSERT INTO listens (preset_id, ip_hash, heard, stayed)
      SELECT id, ${ipHash}, current_date, ${stay ? sql`current_date` : sql`NULL::date`} FROM presets
      WHERE id = ${parsed.data.presetId} AND NOT hidden AND ip_hash <> ${ipHash}
      ON CONFLICT (preset_id, ip_hash) DO UPDATE SET ${
        stay
          ? sql`heard = EXCLUDED.heard, stayed = EXCLUDED.stayed
            WHERE listens.stayed IS NULL OR listens.stayed < EXCLUDED.stayed`
          : sql`heard = EXCLUDED.heard WHERE listens.heard < EXCLUDED.heard`
      }`;
    return empty();
  } catch (error) {
    return errorResponse(error);
  }
};

export const config: Config = {
  path: '/api/usage',
};
