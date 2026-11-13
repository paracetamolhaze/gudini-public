-- A missing platform view counter is unknown, rather than a measured zero.
-- Keep historical values: an old stored zero may be genuine and cannot be reclassified safely.
ALTER TABLE insight_snapshots ALTER COLUMN views DROP NOT NULL;
ALTER TABLE insight_snapshots ALTER COLUMN views DROP DEFAULT;
