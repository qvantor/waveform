import type { Config } from '@netlify/functions';
import { db } from '../utils/db';
import { envNumber } from '../utils/env';

// score: diminishing returns of play time (sqrt) with a 7 days half-life
export default async () => {
  const minUniqueUsers = envNumber('MIN_UNIQUE_USERS', 2);
  await db().begin(async (sql) => {
    await sql`DELETE FROM preset_scores`;
    await sql`
      INSERT INTO preset_scores (preset_id, score, unique_users, updated_at)
      SELECT preset_id,
        SUM(sqrt(seconds) * power(0.5, (current_date - day) / 7.0)),
        COUNT(DISTINCT client_hash),
        now()
      FROM usage_daily
      WHERE day > current_date - 60
      GROUP BY preset_id
      HAVING COUNT(DISTINCT client_hash) >= ${minUniqueUsers}`;
    await sql`
      UPDATE presets SET qualified_at = now()
      WHERE qualified_at IS NULL
        AND id IN (SELECT preset_id FROM preset_scores)`;
  });
};

// changing the interval requires a deploy, can be relaxed to */15 later
export const config: Config = {
  schedule: '*/5 * * * *',
};
