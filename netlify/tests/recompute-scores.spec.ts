import recomputeScores, { config } from '../functions/recompute-scores.mjs';
import { createFakeSql } from './fake-sql';

const mockSql = createFakeSql();
jest.mock('../utils/db', () => ({ db: () => mockSql.sql }));

beforeEach(() => {
  mockSql.reset();
});

afterEach(() => {
  delete process.env.MIN_UNIQUE_USERS;
  delete process.env.POPULAR_MIN_USERS;
  delete process.env.SCORE_PRIOR_LISTENERS;
});

it('runs every 30 minutes', () => {
  expect(config.schedule).toBe('*/30 * * * *');
});

// the score query and its values: the prior (three times), the popular minimum, the minimum of listeners who stayed
const insertQuery = async () => {
  await recomputeScores();
  return mockSql.queries[1];
};
const values = ({ prior = 10, popularMin = 10, min = 2 } = {}) => [prior, prior, prior, popularMin, min];

it('rebuilds scores and qualifies scored presets in one transaction', async () => {
  await recomputeScores();
  const [clear, insert, qualify] = mockSql.queries;
  expect(mockSql.queries).toHaveLength(3);
  expect(mockSql.queries.every(({ transaction }) => transaction)).toBe(true);

  expect(clear.text).toBe('DELETE FROM preset_scores');

  expect(insert.text).toMatch(/^WITH weighted AS \(/);
  expect(insert.text).toContain(
    'INSERT INTO preset_scores (preset_id, score, unique_users, popular) SELECT t.preset_id,'
  );
  expect(insert.text).toMatch(/FROM totals t, site WHERE t.votes >= \$5$/);
  expect(insert.values).toEqual(values());

  expect(qualify.text).toContain('UPDATE presets SET qualified_at = now()');
  expect(qualify.text).toContain('WHERE qualified_at IS NULL');
  expect(qualify.text).toContain('id IN (SELECT preset_id FROM preset_scores)');
});

it('weights the listens and stays of the last 60 days with a 7 days half-life since their day', async () => {
  const { text } = await insertQuery();
  // usage stores one row per IP and preset with the days of the last listen and stay, without the author's own
  expect(text).toContain(
    'WITH weighted AS ( SELECT preset_id, power(0.5, (current_date - heard) / 7.0) AS listen, ' +
      'CASE WHEN stayed > current_date - 60 THEN power(0.5, (current_date - stayed) / 7.0) END AS stay ' +
      'FROM listens WHERE heard > current_date - 60 )'
  );
  expect(text).not.toContain('JOIN presets');
});

it('counts the listeners who stayed as votes and sums the weights per preset', async () => {
  expect((await insertQuery()).text).toContain(
    'totals AS ( SELECT preset_id, count(stay) AS votes, COALESCE(SUM(stay), 0) AS stayed, SUM(listen) AS heard ' +
      'FROM weighted GROUP BY preset_id )'
  );
});

it('takes the site share of all presets, each weighing as at most the prior of listeners', async () => {
  // the top's traffic doesn't make the average: the top doesn't compare itself with itself
  expect((await insertQuery()).text).toContain(
    'site AS ( SELECT SUM(weight * stayed / heard) / SUM(weight) AS share ' +
      'FROM (SELECT stayed, heard, LEAST(heard, $1::numeric) AS weight FROM totals) capped )'
  );
});

it('scores by the share of listeners who stayed with the prior of the site share, shows the votes as users', async () => {
  expect((await insertQuery()).text).toContain(
    'SELECT t.preset_id, (t.stayed + $2::numeric * site.share) / (t.heard + $3::numeric), t.votes,'
  );
});

it('marks presets with a minimum of votes and a share not below the site share as popular', async () => {
  // the site share is a rounded quotient: with a tolerance a preset at exactly the average counts
  expect((await insertQuery()).text).toContain(
    't.votes >= $4 AND t.stayed / t.heard >= site.share - 1e-12 FROM totals t, site'
  );
});

it('takes the minimum of votes from MIN_UNIQUE_USERS', async () => {
  process.env.MIN_UNIQUE_USERS = '10';
  expect((await insertQuery()).values).toEqual(values({ min: 10 }));
});

it('takes the popular minimum from POPULAR_MIN_USERS and the prior from SCORE_PRIOR_LISTENERS', async () => {
  process.env.POPULAR_MIN_USERS = '25';
  process.env.SCORE_PRIOR_LISTENERS = '4.5';
  expect((await insertQuery()).values).toEqual(values({ popularMin: 25, prior: 4.5 }));
});

it.each(['0', '-1', 'abc'])('uses the default thresholds and prior for %s', async (value) => {
  process.env.MIN_UNIQUE_USERS = value;
  process.env.POPULAR_MIN_USERS = value;
  process.env.SCORE_PRIOR_LISTENERS = value;
  expect((await insertQuery()).values).toEqual(values());
});

it('stops when a query fails', async () => {
  mockSql.respond(/INSERT INTO preset_scores/, new Error('timeout'));
  await expect(recomputeScores()).rejects.toThrow('timeout');
  expect(mockSql.queries).toHaveLength(2);
});
