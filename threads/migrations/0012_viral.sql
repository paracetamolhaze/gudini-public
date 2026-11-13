-- Залетевшие чужие посты: из них пишутся переводы (английские) и переделки (русские).
-- Счётчики обновляются при каждой встрече поста в выдаче, поэтому видно, как он разгоняется.
CREATE TABLE viral_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('threads', 'x')),
  external_id text NOT NULL,
  username text NOT NULL,
  permalink text NOT NULL,
  text text NOT NULL,
  lang text NOT NULL,
  media text NOT NULL DEFAULT 'text',
  image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  likes integer NOT NULL DEFAULT 0,
  replies integer NOT NULL DEFAULT 0,
  reposts integer NOT NULL DEFAULT 0,
  views bigint,
  posted_at timestamptz,
  query text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- NEW — ждёт; USED — по нему написан пост; SKIPPED — модель или фильтр отказались (reason).
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'USED', 'SKIPPED')),
  reason text,
  draft_id uuid REFERENCES drafts(id) ON DELETE SET NULL,
  UNIQUE (platform, external_id)
);
CREATE INDEX viral_posts_pick_idx ON viral_posts (status, lang, posted_at DESC);

-- Когда какой поисковый запрос читали в последний раз: каждый прогон берёт самые давние.
CREATE TABLE viral_queries (
  source text NOT NULL,
  query text NOT NULL,
  last_run_at timestamptz,
  last_found integer NOT NULL DEFAULT 0,
  last_error text,
  PRIMARY KEY (source, query)
);
