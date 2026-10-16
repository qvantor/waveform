-- Popularity by the share of listeners who stayed, counted from scratch.
-- Apply once: psql "$DATABASE_URL" -f db/migrations/004_listens.sql
-- Drops the play time and scores of 001 (and the tables of an unreleased build), presets keep qualified_at.
-- Apply it together with the deploy: usage and recompute-scores of the old build write and read the dropped usage_daily

BEGIN;

DROP TABLE IF EXISTS usage_daily;
DROP TABLE IF EXISTS stays;
DROP TABLE IF EXISTS preset_scores;

-- a listener (an IP, see ipKey) of a preset: the last day a note was played on it and the last stay, played it for
-- a minute without switching to another one (see recompute-scores); the author's own and hidden presets are not
-- stored, later listens and stays renew the days
CREATE TABLE listens (
  preset_id uuid REFERENCES presets ON DELETE CASCADE,
  ip_hash text NOT NULL,
  heard date NOT NULL,
  stayed date,          -- NULL: never stayed; a stay is a listen too, stayed <= heard
  PRIMARY KEY (preset_id, ip_hash)
);

CREATE TABLE preset_scores (
  preset_id uuid PRIMARY KEY REFERENCES presets ON DELETE CASCADE,
  score float8 NOT NULL,      -- the share of listeners who stayed, with the prior of the site's share
  unique_users int NOT NULL,  -- the listeners who stayed
  popular boolean NOT NULL    -- passed the Popular threshold, only such presets are in the top
);
-- the top: popular presets by score
CREATE INDEX ON preset_scores (score DESC, preset_id) WHERE popular;

COMMIT;
