import cleanup, { config } from '../functions/cleanup.mjs';
import { createFakeSql } from './fake-sql';

const mockSql = createFakeSql();
jest.mock('../utils/db', () => ({ db: () => mockSql.sql }));

beforeEach(() => {
  mockSql.reset();
});

it('runs daily', () => {
  expect(config.schedule).toBe('@daily');
});

it('removes old unqualified presets and old usage', async () => {
  await cleanup();
  const [presets, usage] = mockSql.queries;
  expect(mockSql.queries).toHaveLength(2);
  expect(presets.text).toBe(
    "DELETE FROM presets WHERE created_at < now() - interval '90 days' AND qualified_at IS NULL AND NOT featured"
  );
  expect(usage.text).toBe('DELETE FROM usage_daily WHERE day < current_date - 60');
});
