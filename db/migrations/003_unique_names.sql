-- Unique preset names, case-insensitive. Apply once: psql "$DATABASE_URL" -f db/migrations/003_unique_names.sql

-- collapse whitespace in existing names (new names are normalized by the API)
UPDATE presets SET name = regexp_replace(btrim(name), '\s+', ' ', 'g')
WHERE name <> regexp_replace(btrim(name), '\s+', ' ', 'g');

-- rename existing duplicates: "Pad", "Pad (2)", "Pad (3)", ...; the oldest keeps the name
WITH d AS (
  SELECT id, name, row_number() OVER (PARTITION BY lower(name) ORDER BY created_at, id) AS rn FROM presets
)
UPDATE presets p
SET name = left(d.name, 40 - length(' (' || d.rn || ')')) || ' (' || d.rn || ')'
FROM d WHERE p.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX presets_name_key ON presets (lower(name));
