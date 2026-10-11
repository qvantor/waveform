-- Presets storage. Apply once: psql "$DATABASE_URL" -f db/migrations/001_presets.sql
-- gen_random_uuid() is built in since Postgres 13.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hash text UNIQUE NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  data jsonb NOT NULL,
  ip_hash text NOT NULL,
  hidden boolean NOT NULL DEFAULT false,   -- hidden by reports or manually
  featured boolean NOT NULL DEFAULT false, -- curated, fills "Popular" on cold start
  qualified_at timestamptz,                -- first time the preset passed quarantine, such presets are never cleaned up
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON presets (ip_hash, created_at);
CREATE INDEX ON presets (created_at DESC, id DESC);
CREATE INDEX ON presets (name, id);
CREATE INDEX ON presets USING gin (name gin_trgm_ops);

CREATE TABLE usage_daily (
  preset_id uuid REFERENCES presets ON DELETE CASCADE,
  client_hash text NOT NULL,
  ip_hash text NOT NULL,
  day date NOT NULL,
  seconds int NOT NULL,
  PRIMARY KEY (preset_id, client_hash, day)
);
CREATE INDEX ON usage_daily (preset_id, ip_hash, day);

CREATE TABLE preset_scores (
  preset_id uuid PRIMARY KEY REFERENCES presets ON DELETE CASCADE,
  score float8 NOT NULL,
  unique_users int NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX ON preset_scores (score DESC, preset_id);

CREATE TABLE reports (
  preset_id uuid REFERENCES presets ON DELETE CASCADE,
  ip_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (preset_id, ip_hash)
);
-- not in the original plan: "20 reports per hour per IP" check needs it
CREATE INDEX ON reports (ip_hash, created_at);
