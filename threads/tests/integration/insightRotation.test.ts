import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { query, setPoolForTests } from "../../src/db/pool.js";
import { loadEnv, setEnvForTests } from "../../src/config/env.js";
import { invalidateSettingsCache, saveSettings } from "../../src/config/settings.js";
import { runMigrations } from "../../src/db/migrate.js";
import { setPlatformForTests, type PlatformAdapter } from "../../src/platforms/index.js";
import { captureInsights } from "../../src/services/analytics/insights.js";

test("failed insights rotate past a full batch so unmeasured and stale valid posts still refresh", {
  skip: process.env.INSIGHT_ROTATION_TEST !== "1",
  timeout: 60_000,
}, async () => {
  const connectionString = process.env.DATABASE_URL!;
  assert.match(new URL(connectionString).pathname, /^\/threads_stats_test_[a-z0-9_]+$/, "requires an isolated statistics test database");
  setEnvForTests(loadEnv({ ...process.env, NODE_ENV: "test", LOG_LEVEL: "error", REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379/15" }));
  const pool = new pg.Pool({ connectionString });
  setPoolForTests(pool);
  const calls: string[] = [];
  setPlatformForTests("threads", {
    id: "threads",
    label: "Threads",
    configured: () => true,
    async metrics(id: string) {
      calls.push(id);
      if (id.startsWith("fail-")) throw new Error("post no longer exists");
      return { views: 100, likes: 2, replies: 1, reposts: 0, quotes: 0, shares: 0 };
    },
  } as PlatformAdapter);

  try {
    await runMigrations();
    await query("TRUNCATE publications, drafts, settings, audit_logs CASCADE");
    invalidateSettingsCache();
    await saveSettings({ platforms: { threads: { enabled: true }, x: { enabled: false } }, analytics: { snapshotDays: 1 } });

    await query(`INSERT INTO publications(platform, platform_post_id, published_text, published_at)
      SELECT 'threads', 'fail-' || n, 'Deleted old post', '2000-01-01T00:00:00Z'::timestamptz + n * interval '1 minute'
      FROM generate_series(1, 45) n`);
    await query(`INSERT INTO publications(platform, platform_post_id, published_text, published_at)
      SELECT 'threads', 'unmeasured-' || n, 'Valid unmeasured post', '2001-01-01T00:00:00Z'::timestamptz + n * interval '1 minute'
      FROM generate_series(1, 5) n`);
    await query(`INSERT INTO publications(platform, platform_post_id, published_text, published_at)
      SELECT 'threads', 'stale-' || n, 'Valid old measured post', '2002-01-01T00:00:00Z'::timestamptz + n * interval '1 minute'
      FROM generate_series(1, 5) n`);
    await query(`INSERT INTO insight_snapshots(publication_id, platform, platform_post_id, captured_at, views, likes, replies)
      SELECT id, platform, platform_post_id, '2020-01-01T00:00:00Z', 10, 1, 0
      FROM publications WHERE platform_post_id LIKE 'stale-%'`);

    const first = await captureInsights();
    assert.deepEqual(first, { captured: 0, skipped: 40, error: null });
    assert.deepEqual(calls, Array.from({ length: 40 }, (_, n) => `fail-${n + 1}`));
    const attempted = await query<{ n: number }>("SELECT count(*) AS n FROM publications WHERE insights_attempted_at IS NOT NULL");
    assert.equal(attempted[0]?.n, 40, "a failed metrics request must still advance its attempt timestamp");

    calls.length = 0;
    const second = await captureInsights();
    assert.equal(calls.length, 40, "the collector remains bounded to one batch");
    assert.deepEqual(second, { captured: 10, skipped: 30, error: null });
    for (let n = 1; n <= 5; n++) {
      assert.ok(calls.includes(`unmeasured-${n}`), "previous failures cannot starve valid posts without snapshots");
      assert.ok(calls.includes(`stale-${n}`), "previous failures cannot starve valid posts with old snapshots");
    }
    const fresh = await query<{ platform_post_id: string; snapshots: number }>(`
      SELECT p.platform_post_id, count(s.id) AS snapshots
      FROM publications p JOIN insight_snapshots s ON s.publication_id = p.id
      WHERE p.platform_post_id LIKE 'stale-%' OR p.platform_post_id LIKE 'unmeasured-%'
      GROUP BY p.id ORDER BY p.platform_post_id`);
    assert.equal(fresh.length, 10);
    assert.ok(fresh.every((post) => post.snapshots === (post.platform_post_id.startsWith("stale-") ? 2 : 1)));

    calls.length = 0;
    await captureInsights();
    assert.ok(calls.every((id) => id.startsWith("fail-")), "recently successful snapshots retain the two-hour freshness guard");
  } finally {
    setPlatformForTests("threads", null);
    invalidateSettingsCache();
    setPoolForTests(null);
    setEnvForTests(null);
    await pool.end();
  }
});
