import recomputeScores, { config } from '../functions/recompute-scores.mjs';
import { createFakeSql } from './fake-sql';

const mockSql = createFakeSql();
jest.mock('../utils/db', () => ({ db: () => mockSql.sql }));

beforeEach(() => {
  mockSql.reset();
});

afterEach(() => {
  delete process.env.MIN_UNIQUE_USERS;
});

it('runs every 5 minutes', () => {
  expect(config.schedule).toBe('*/5 * * * *');
});

it('rebuilds scores and qualifies scored presets in one transaction', async () => {
  await recomputeScores();
  const [clear, insert, qualify] = mockSql.queries;
  expect(mockSql.queries).toHaveLength(3);
  expect(mockSql.queries.every(({ transaction }) => transaction)).toBe(true);

  expect(clear.text).toBe('DELETE FROM preset_scores');

  expect(insert.text).toMatch(/^INSERT INTO preset_scores/);
  expect(insert.text).toContain('SUM(sqrt(seconds) * power(0.5, (current_date - day) / 7.0))');
  expect(insert.text).toContain('WHERE day > current_date - 60');
  expect(insert.text).toContain('HAVING COUNT(DISTINCT client_hash) >= $1');
  expect(insert.values).toEqual([2]);

  expect(qualify.text).toContain('UPDATE presets SET qualified_at = now()');
  expect(qualify.text).toContain('WHERE qualified_at IS NULL');
  expect(qualify.text).toContain('id IN (SELECT preset_id FROM preset_scores)');
});

it('takes the minimum of unique users from MIN_UNIQUE_USERS', async () => {
  process.env.MIN_UNIQUE_USERS = '10';
  await recomputeScores();
  expect(mockSql.queries[1].values).toEqual([10]);
});

it('stops when a query fails', async () => {
  mockSql.respond(/^INSERT INTO preset_scores/, new Error('timeout'));
  await expect(recomputeScores()).rejects.toThrow('timeout');
  expect(mockSql.queries).toHaveLength(2);
});
