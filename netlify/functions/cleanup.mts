import type { Config } from '@netlify/functions';
import { db } from '../utils/db';

// removes presets that never passed quarantine and old usage
export default async () => {
  const sql = db();
  await sql`
    DELETE FROM presets
    WHERE created_at < now() - interval '90 days'
      AND qualified_at IS NULL AND NOT featured`;
  await sql`DELETE FROM usage_daily WHERE day < current_date - 60`;
};

export const config: Config = {
  schedule: '@daily',
};
