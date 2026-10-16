import type { Config } from '@netlify/functions';
import { db } from '../utils/db';

// removes presets that never passed quarantine 90 days after they were saved, edited or opened by their author
// (GREATEST skips NULLs), listeners who didn't play a preset during the 60 days of the scores, and reports of hidden
// presets (they did their job, a preset shown again counts from 0) or older than 180 days: REPORT_HIDE_THRESHOLD
// reports in half a year hide a preset, not those of years
export default async () => {
  const sql = db();
  await sql`
    DELETE FROM presets
    WHERE GREATEST(created_at, updated_at, author_opened_at) < now() - interval '90 days'
      AND qualified_at IS NULL AND NOT featured`;
  await sql`DELETE FROM listens WHERE heard < current_date - 60`;
  await sql`
    DELETE FROM reports
    WHERE created_at < now() - interval '180 days'
      OR preset_id IN (SELECT id FROM presets WHERE hidden)`;
};

export const config: Config = {
  schedule: '@daily',
};
