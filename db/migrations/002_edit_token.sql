-- Editing own presets. Apply once: psql "$DATABASE_URL" -f db/migrations/002_edit_token.sql

-- sha256 of the secret edit token given to the author on create; NULL for older presets, they can't be edited
ALTER TABLE presets ADD COLUMN edit_token_hash text;
ALTER TABLE presets ADD COLUMN updated_at timestamptz;
