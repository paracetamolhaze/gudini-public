import { one } from "../../db/pool.js";
import { clampInt } from "../../shared/ids.js";
import type { MetricTotals, PublicationStatsReport } from "../../shared/publicationStats.js";

/**
 * Keep aggregation and pagination in one database snapshot. A cross-post is one
 * logical post, while each platform contributes its own latest measured counters.
 * SUM is deliberately not narrowed to int: lifetime views can exceed 2^31 - 1.
 */
const REPORT_SQL = `
  WITH measured AS (
    SELECT p.id, COALESCE(p.draft_id, p.id) AS post_id, p.platform,
           p.published_text, p.published_at, p.permalink,
           s.id AS snapshot_id, s.views, s.likes, s.replies, s.captured_at
    FROM publications p
    LEFT JOIN LATERAL (
      SELECT id, views, likes, replies, captured_at
      FROM insight_snapshots
      WHERE publication_id = p.id
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    ) s ON true
    WHERE p.dry_run = false AND p.platform IN ('threads', 'x')
  ), post_totals AS (
    SELECT post_id,
           (array_agg(published_text ORDER BY (platform = 'threads') DESC, published_at DESC, id DESC))[1] AS text,
           max(published_at) AS published_at,
           bool_or(snapshot_id IS NOT NULL) AS measured,
           sum(views) AS views, sum(likes) AS likes, sum(replies) AS replies,
           max(captured_at) AS updated_at,
           jsonb_object_agg(platform, jsonb_build_object(
             'posts', 1, 'measuredPosts', CASE WHEN snapshot_id IS NOT NULL THEN 1 ELSE 0 END,
             'views', views, 'likes', likes, 'replies', replies,
             'updatedAt', captured_at, 'permalink', permalink
           )) AS platforms
    FROM measured
    GROUP BY post_id
  ), all_totals AS (
    SELECT count(*) AS posts, count(*) FILTER (WHERE measured) AS "measuredPosts",
           sum(views) AS views, sum(likes) AS likes, sum(replies) AS replies,
           max(updated_at) AS "updatedAt"
    FROM post_totals
  ), platform_totals AS (
    SELECT names.platform, count(p.id) AS posts, count(p.snapshot_id) AS "measuredPosts",
           sum(p.views) AS views, sum(p.likes) AS likes, sum(p.replies) AS replies,
           max(p.captured_at) AS "updatedAt"
    FROM (VALUES ('threads'), ('x')) names(platform)
    LEFT JOIN measured p ON p.platform = names.platform
    GROUP BY names.platform
  ), page AS (
    SELECT post_id AS id, text, published_at AS "publishedAt",
           jsonb_build_object(
             'posts', 1, 'measuredPosts', CASE WHEN measured THEN 1 ELSE 0 END,
             'views', views, 'likes', likes, 'replies', replies, 'updatedAt', updated_at
           ) AS totals, platforms
    FROM post_totals
    ORDER BY published_at DESC, post_id DESC
    LIMIT $1 OFFSET $2
  )
  SELECT (SELECT to_jsonb(t) FROM all_totals t) AS totals,
         (SELECT jsonb_object_agg(platform, to_jsonb(t) - 'platform') FROM platform_totals t) AS platforms,
         COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."publishedAt" DESC, p.id DESC) FROM page p), '[]'::jsonb) AS posts,
         (SELECT posts FROM all_totals) AS "totalPosts"
`;

function normalizeTimestamp(totals: MetricTotals): void {
  if (totals.updatedAt !== null) totals.updatedAt = new Date(totals.updatedAt).toISOString();
}

export async function publicationStatsReport(limit = 20, offset = 0): Promise<PublicationStatsReport> {
  const pageLimit = clampInt(limit, 1, 100, 20);
  const pageOffset = clampInt(offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const report = await one<Omit<PublicationStatsReport, "limit" | "offset">>(REPORT_SQL, [pageLimit, pageOffset]);
  if (!report) throw new Error("Publication statistics query returned no aggregate row");

  normalizeTimestamp(report.totals);
  for (const totals of Object.values(report.platforms)) normalizeTimestamp(totals);
  for (const post of report.posts) {
    post.publishedAt = new Date(post.publishedAt).toISOString();
    normalizeTimestamp(post.totals);
    for (const totals of Object.values(post.platforms)) normalizeTimestamp(totals);
  }
  return { ...report, limit: pageLimit, offset: pageOffset };
}
