import { loadSettings } from "../../config/settings.js";
import { query } from "../../db/pool.js";
import { activePlatforms, type PlatformId } from "../../platforms/index.js";
import { PermissionError, RateLimitError } from "../../threads/errors.js";
import { audit } from "../audit.js";
import { errorMessage } from "../../shared/logger.js";

/** Refresh every real publication over bounded rounds, including the older posts shown in all-time totals. */
export async function captureInsights(): Promise<{ captured: number; skipped: number; error: string | null }> {
  const settings = await loadSettings();
  const active = new Map(activePlatforms(settings).map((a) => [a.id, a]));
  if (!active.size) return { captured: 0, skipped: 0, error: "no platform connected" };
  const rows = await query<{ id: string; platform: PlatformId; platform_post_id: string }>(
    `WITH eligible AS (
       SELECT p.id, p.platform, p.platform_post_id, p.published_at,
              GREATEST(latest.captured_at, p.insights_attempted_at) AS last_checked_at
       FROM publications p
       LEFT JOIN LATERAL (
         SELECT s.captured_at FROM insight_snapshots s
         WHERE s.publication_id = p.id ORDER BY s.captured_at DESC LIMIT 1
       ) latest ON true
       WHERE p.dry_run = false AND p.platform = ANY($1::text[])
         AND (latest.captured_at IS NULL OR latest.captured_at < now() - interval '2 hours')
     ), ranked AS (
       SELECT id, platform, platform_post_id,
         row_number() OVER (
           PARTITION BY platform ORDER BY last_checked_at ASC NULLS FIRST, published_at ASC, id
         ) AS platform_rank
       FROM eligible
     )
     SELECT id, platform, platform_post_id FROM ranked
     ORDER BY platform_rank, platform LIMIT 40`,
    [[...active.keys()]],
  );
  let captured = 0;
  let skipped = 0;
  const blocked = new Set<PlatformId>();
  const errors: string[] = [];
  for (const p of rows) {
    const adapter = active.get(p.platform);
    if (!adapter || blocked.has(p.platform)) {
      skipped++;
      continue;
    }
    try {
      // Failed/deleted posts must take their turn too, so they cannot monopolize future batches.
      await query(`UPDATE publications SET insights_attempted_at = now() WHERE id = $1`, [p.id]);
      const m = await adapter.metrics(p.platform_post_id);
      await query(`INSERT INTO insight_snapshots (publication_id, platform, platform_post_id, views, likes, replies, reposts, quotes, shares) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [p.id, p.platform, p.platform_post_id, m.views, m.likes, m.replies, m.reposts, m.quotes, m.shares]);
      captured++;
    } catch (err) {
      skipped++;
      if (err instanceof PermissionError || err instanceof RateLimitError) {
        // One refusal speaks for the whole platform this round.
        blocked.add(p.platform);
        const msg = err instanceof PermissionError ? `${adapter.label} insights: нужно разрешение ${err.scope ?? "threads_manage_insights"}` : `${adapter.label} insights: лимит API`;
        errors.push(msg);
        await audit("INSIGHTS_CAPTURED", msg, {}, { platform: p.platform }, "warn");
        continue;
      }
      await audit("INSIGHTS_CAPTURED", `Не удалось получить метрики для ${p.platform}:${p.platform_post_id}: ${errorMessage(err)}`, { publicationId: p.id }, null, "warn");
    }
  }
  if (captured) await audit("INSIGHTS_CAPTURED", `Снимки метрик: ${captured} публикаций`, {}, { captured, skipped });
  return { captured, skipped, error: errors.length ? errors.join("; ") : null };
}
