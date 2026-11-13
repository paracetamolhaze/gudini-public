import { query } from "../pool.js";
import type { ViralLang } from "../../services/viral/plan.js";

export interface ViralPostRow {
  id: string;
  platform: "threads" | "x";
  external_id: string;
  username: string;
  permalink: string;
  text: string;
  lang: ViralLang;
  media: string;
  image_urls: string[];
  likes: number;
  replies: number;
  reposts: number;
  views: number | null;
  posted_at: Date | null;
  query: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  status: "NEW" | "USED" | "SKIPPED";
  reason: string | null;
  draft_id: string | null;
}

export interface FoundViralPost {
  platform: "threads" | "x";
  externalId: string;
  username: string;
  permalink: string;
  text: string;
  lang: ViralLang;
  media: string;
  imageUrls: string[];
  likes: number;
  replies: number;
  reposts: number;
  views: number | null;
  postedAt: Date | null;
  query: string;
}

/** Встретили пост снова — счётчики только растут: старый снимок не перетирает свежий. */
export async function upsertViralPost(p: FoundViralPost): Promise<void> {
  await query(
    `INSERT INTO viral_posts (platform, external_id, username, permalink, text, lang, media, image_urls, likes, replies, reposts, views, posted_at, query)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (platform, external_id) DO UPDATE SET
       likes = GREATEST(viral_posts.likes, EXCLUDED.likes),
       replies = GREATEST(viral_posts.replies, EXCLUDED.replies),
       reposts = GREATEST(viral_posts.reposts, EXCLUDED.reposts),
       views = CASE WHEN EXCLUDED.views IS NULL THEN viral_posts.views ELSE GREATEST(COALESCE(viral_posts.views, 0), EXCLUDED.views) END,
       last_seen_at = now()`,
    [p.platform, p.externalId, p.username, p.permalink, p.text, p.lang, p.media, JSON.stringify(p.imageUrls), p.likes, p.replies, p.reposts, p.views, p.postedAt, p.query],
  );
}

/** Свежие неиспользованные посты нужного языка; сортировку по силе делает вызывающий. */
export async function viralCandidates(lang: ViralLang, maxAgeHours: number, limit = 300): Promise<ViralPostRow[]> {
  return query<ViralPostRow>(
    `SELECT * FROM viral_posts
      WHERE status = 'NEW' AND lang = $1
        AND COALESCE(posted_at, first_seen_at) > now() - $2 * interval '1 hour'
      ORDER BY last_seen_at DESC LIMIT $3`,
    [lang, maxAgeHours, limit],
  );
}

export async function skipViralPost(id: string, reason: string): Promise<void> {
  await query(`UPDATE viral_posts SET status = 'SKIPPED', reason = $2 WHERE id = $1 AND status = 'NEW'`, [id, reason.slice(0, 300)]);
}

export async function useViralPost(id: string, draftId: string, why: string): Promise<void> {
  await query(`UPDATE viral_posts SET status = 'USED', draft_id = $2, reason = $3 WHERE id = $1`, [id, draftId, why.slice(0, 600)]);
}

/** Автор, которого мы недавно уже взяли: два поста подряд по одному человеку выглядят как копирование. */
export async function recentlyUsedAuthors(days = 7): Promise<Set<string>> {
  const rows = await query<{ key: string }>(
    `SELECT DISTINCT platform || ':' || lower(username) AS key FROM viral_posts WHERE status = 'USED' AND last_seen_at > now() - $1 * interval '1 day'`,
    [days],
  );
  return new Set(rows.map((r) => r.key));
}

/** Запросы, которые дольше всех не читали (новые — первыми). Список запросов задают настройки. */
export async function staleQueries(source: "threads" | "x", all: string[], n: number): Promise<string[]> {
  if (!all.length || n <= 0) return [];
  const rows = await query<{ query: string; last_run_at: Date | null }>(`SELECT query, last_run_at FROM viral_queries WHERE source = $1`, [source]);
  const last = new Map(rows.map((r) => [r.query, r.last_run_at?.getTime() ?? 0]));
  return [...new Set(all)].sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0)).slice(0, n);
}

export async function markQueryRun(source: "threads" | "x", q: string, found: number, error: string | null): Promise<void> {
  await query(
    `INSERT INTO viral_queries (source, query, last_run_at, last_found, last_error) VALUES ($1,$2,now(),$3,$4)
     ON CONFLICT (source, query) DO UPDATE SET last_run_at = now(), last_found = EXCLUDED.last_found, last_error = EXCLUDED.last_error`,
    [source, q, found, error],
  );
}

/** Неиспользованное старше двух недель уже не тренд: таблица не копит мусор. */
export async function pruneViralPosts(): Promise<number> {
  const rows = await query<{ id: string }>(`DELETE FROM viral_posts WHERE status <> 'USED' AND last_seen_at < now() - interval '14 days' RETURNING id`);
  return rows.length;
}

export interface ViralDayStats {
  done: { translate: number; remake: number };
  pending: number;
  lastCreatedAt: Date | null;
}

/** Что уже написано за день публикаций: вышедшее и ждущее считается, отклонённое и упавшее — нет. */
export async function viralDayStats(dayStart: Date): Promise<ViralDayStats> {
  const counts = await query<{ type: string; n: number }>(
    `SELECT type, count(*)::int AS n FROM drafts
      WHERE kind = 'VIRAL' AND created_at >= $1
        AND status IN ('DRAFT','NEEDS_REVIEW','APPROVED','SCHEDULED','PUBLISHING','PUBLISHED','PARTIAL')
      GROUP BY type`,
    [dayStart],
  );
  const pending = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM drafts WHERE kind = 'VIRAL' AND status IN ('GENERATING','DRAFT','APPROVED','SCHEDULED','PUBLISHING')
       AND (expires_at IS NULL OR expires_at > now())`,
  );
  const last = await query<{ at: Date | null }>(
    `SELECT max(created_at) AS at FROM drafts WHERE kind = 'VIRAL' AND status NOT IN ('FAILED','REJECTED')`,
  );
  const by = new Map(counts.map((c) => [c.type, c.n]));
  return {
    done: { translate: by.get("TRANSLATION") ?? 0, remake: by.get("REMAKE") ?? 0 },
    pending: pending[0]?.n ?? 0,
    lastCreatedAt: last[0]?.at ?? null,
  };
}

/**
 * Просмотры наших постов Threads по местному часу выхода — за 60 дней, только посты старше 12 часов
 * (их цифры уже устоялись). Из этого считается, в какие часы посты набирают больше.
 */
export async function viewsByHour(timezone: string): Promise<Array<{ hour: number; views: number }>> {
  return query<{ hour: number; views: number }>(
    `WITH last AS (SELECT DISTINCT ON (publication_id) publication_id, views FROM insight_snapshots ORDER BY publication_id, captured_at DESC)
     SELECT extract(hour FROM p.published_at AT TIME ZONE $1)::int AS hour, l.views
       FROM publications p JOIN last l ON l.publication_id = p.id
      WHERE p.platform = 'threads' AND NOT p.dry_run AND l.views IS NOT NULL
        AND p.published_at BETWEEN now() - interval '60 days' AND now() - interval '12 hours'`,
    [timezone],
  );
}
