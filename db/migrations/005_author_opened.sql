-- Own presets kept by their authors. Apply once: psql "$DATABASE_URL" -f db/migrations/005_author_opened.sql

-- the last time the author opened the preset (the client sends its edit token, POST /api/presets/:id/opened);
-- cleanup removes an unqualified preset 90 days after it was saved, edited or opened by its author;
-- IF NOT EXISTS: databases that got it as 006 of an unreleased build
ALTER TABLE presets ADD COLUMN IF NOT EXISTS author_opened_at timestamptz;
