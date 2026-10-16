import type { Config } from '@netlify/functions';
import { db } from '../utils/db';
import { envNumber } from '../utils/env';

// the score is the share of listeners who stayed: a listener is an IP (an IPv6 /64, see ipKey) that played the preset
// for USAGE_LISTEN_SECONDS, a stay is playing it for USAGE_STAY_SECONDS, both without switching to another one (see
// usage). A share, not a count: presets of the top get most listeners (they open on start and with ◀ ▶), more
// listeners only make their share surer, a preset found in the list gets there with listeners who stay. Not counted:
// the preset opened on start (the client doesn't send it, its listeners didn't choose it) and the author's own
// presets (usage doesn't store them). Over the last 60 days, the listens and stays weighted with a 7 days half-life
// since their last day
// score: (stays + prior × the site's share) / (listens + prior), a preset with few listeners stays near the site's
// share; prior is SCORE_PRIOR_LISTENERS (the `popular` sort, the top)
// the site's share: the share of all presets, each weighs as at most `prior` listeners. The top gets most listeners,
// with all of them the average would be the top's own one: its lower part would fall below it and out of the top,
// the average would rise to the rest, and so on until a single preset is left
// unique_users: the listeners who stayed; a preset gets a score (leaves quarantine) with MIN_UNIQUE_USERS of them
// popular: at least POPULAR_MIN_USERS listeners who stayed and a share not below the site's share
export default async () => {
  const minUniqueUsers = envNumber('MIN_UNIQUE_USERS', 2);
  const popularMinUsers = envNumber('POPULAR_MIN_USERS', 10);
  const prior = envNumber('SCORE_PRIOR_LISTENERS', 10);
  await db().begin(async (sql) => {
    await sql`DELETE FROM preset_scores`;
    // the site's share is a rounded quotient (numeric), the shares are compared with a tolerance: exactly the
    // average counts
    await sql`
      WITH weighted AS (
        SELECT preset_id,
          power(0.5, (current_date - heard) / 7.0) AS listen,
          CASE WHEN stayed > current_date - 60 THEN power(0.5, (current_date - stayed) / 7.0) END AS stay
        FROM listens
        WHERE heard > current_date - 60
      ), totals AS (
        SELECT preset_id, count(stay) AS votes, COALESCE(SUM(stay), 0) AS stayed, SUM(listen) AS heard
        FROM weighted
        GROUP BY preset_id
      ), site AS (
        SELECT SUM(weight * stayed / heard) / SUM(weight) AS share
        FROM (SELECT stayed, heard, LEAST(heard, ${prior}::numeric) AS weight FROM totals) capped
      )
      INSERT INTO preset_scores (preset_id, score, unique_users, popular)
      SELECT t.preset_id,
        (t.stayed + ${prior}::numeric * site.share) / (t.heard + ${prior}::numeric),
        t.votes,
        t.votes >= ${popularMinUsers} AND t.stayed / t.heard >= site.share - 1e-12
      FROM totals t, site
      WHERE t.votes >= ${minUniqueUsers}`;
    await sql`
      UPDATE presets SET qualified_at = now()
      WHERE qualified_at IS NULL
        AND id IN (SELECT preset_id FROM preset_scores)`;
  });
};

// the weights change once a day, the interval only delays new listens (and leaving quarantine);
// changing it requires a deploy
export const config: Config = {
  schedule: '*/30 * * * *',
};
