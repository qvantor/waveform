-- Marks curated presets as featured, they fill "Popular" until real presets get enough plays.
-- Save presets through the UI, copy ids from the share links (?preset=<id>) and run:
--   psql "$DATABASE_URL" -f scripts/feature-presets.sql

UPDATE presets SET featured = true
WHERE id IN (
  '00000000-0000-0000-0000-000000000000'
  -- , '...'
);

-- check
SELECT id, name, featured, hidden FROM presets WHERE featured ORDER BY created_at;
