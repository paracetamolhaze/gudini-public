-- Account identity is part of every observation: reconnecting another account
-- must never turn the previous account's audience into growth for the new one.
CREATE TABLE follower_snapshots (
  id bigserial PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('threads', 'x')),
  account_id text NOT NULL CHECK (length(account_id) > 0),
  username text NOT NULL,
  followers bigint NOT NULL CHECK (followers >= 0),
  approximate boolean NOT NULL DEFAULT false,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX follower_snapshots_account_time_idx
  ON follower_snapshots (platform, account_id, captured_at DESC, id DESC);

-- The latest attempt determines the current account even if reading its
-- followers failed. A previous account's successful snapshot is not current.
CREATE TABLE follower_collection_state (
  platform text PRIMARY KEY CHECK (platform IN ('threads', 'x')),
  account_id text,
  username text,
  attempted_at timestamptz NOT NULL,
  error text
);
