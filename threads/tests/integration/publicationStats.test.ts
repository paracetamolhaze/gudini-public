import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import Fastify from "fastify";
import { setPoolForTests, query } from "../../src/db/pool.js";
import { loadEnv, setEnvForTests } from "../../src/config/env.js";
import { runMigrations } from "../../src/db/migrate.js";
import { publicationStatsReport } from "../../src/services/analytics/publications.js";
import { registerAnalyticsRoutes } from "../../src/api/routes/analytics.js";

test("publication statistics use real latest snapshots and paginate logical posts", {
  skip: process.env.PUBLICATION_STATS_TEST !== "1",
  timeout: 60_000,
}, async (t) => {
  const connectionString = process.env.DATABASE_URL!;
  assert.match(new URL(connectionString).pathname, /^\/threads_stats_test_[a-z0-9_]+$/, "requires an isolated statistics test database");
  setEnvForTests(loadEnv({ ...process.env, NODE_ENV: "test", REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379/15" }));
  const pool = new pg.Pool({ connectionString });
  setPoolForTests(pool);
  const empty = { posts: 0, measuredPosts: 0, views: null, likes: null, replies: null, updatedAt: null };
  const draftId = "00000000-0000-0000-0000-000000000010";
  const threadsId = "00000000-0000-0000-0000-000000000011";
  const xId = "00000000-0000-0000-0000-000000000012";
  const unmeasuredId = "00000000-0000-0000-0000-000000000001";
  const unknownViewsId = "00000000-0000-0000-0000-000000000002";
  const zeroId = "00000000-0000-0000-0000-000000000003";

  try {
    await runMigrations();
    await query("TRUNCATE publications, drafts CASCADE");

    await t.test("empty accounts distinguish missing observations from observed zeros", async () => {
      assert.deepEqual(await publicationStatsReport(), {
        totals: empty, platforms: { threads: empty, x: empty }, posts: [], totalPosts: 0, limit: 20, offset: 0,
      });
    });

    await query("INSERT INTO drafts(id, text) VALUES ($1, 'Cross-post')", [draftId]);
    await query(`INSERT INTO publications(id, draft_id, platform, platform_post_id, published_text, published_at, permalink, dry_run) VALUES
      ($1, $2, 'threads', 'cross-threads', 'Cross-post Threads text', '2020-01-01T00:00:00Z', 'https://threads.net/cross', false),
      ($3, $2, 'x', 'cross-x', 'Cross-post X text', '2020-01-01T00:01:00Z', 'https://x.com/cross', false),
      ($4, NULL, 'threads', 'unmeasured', 'No snapshots', '2026-10-23T05:00:00Z', NULL, false),
      ($5, NULL, 'x', 'unknown-views', 'Unknown latest views', '2026-10-23T05:00:00Z', 'https://x.com/unknown', false),
      ($6, NULL, 'x', 'zero', 'Measured zeros', '2025-01-01T00:00:00Z', NULL, false),
      ('00000000-0000-0000-0000-000000000099', NULL, 'threads', 'dry-run', 'Dry run', '2030-01-01T00:00:00Z', NULL, true)`,
    [threadsId, draftId, xId, unmeasuredId, unknownViewsId, zeroId]);
    const snapshot = async (id: string, views: number | null, likes: number, replies: number, capturedAt: string) => {
      await query(`INSERT INTO insight_snapshots(publication_id, platform, platform_post_id, views, likes, replies, captured_at)
        SELECT id, platform, platform_post_id, $2, $3, $4, $5 FROM publications WHERE id = $1`, [id, views, likes, replies, capturedAt]);
    };
    await snapshot(threadsId, 999, 999, 999, "2026-10-20T12:00:00Z");
    await snapshot(threadsId, 1_499_999_999, 9, 3, "2026-10-21T12:00:00Z");
    await snapshot(threadsId, 1_500_000_000, 10, 4, "2026-10-21T12:00:00Z");
    await snapshot(xId, 1_600_000_000, 20, 6, "2026-10-22T12:00:00Z");
    await snapshot(unknownViewsId, 888, 8, 8, "2026-10-22T12:00:00Z");
    await snapshot(unknownViewsId, null, 2, 1, "2026-10-23T00:00:00Z");
    await snapshot(zeroId, 0, 0, 0, "2026-10-20T00:00:00Z");
    await snapshot("00000000-0000-0000-0000-000000000099", 2_000_000_000, 100, 100, "2030-01-01T00:00:00Z");

    await t.test("all-time totals count cross-posts once, omit dry runs, and exceed 32-bit counters", async () => {
      const report = await publicationStatsReport();
      assert.deepEqual(report.totals, {
        posts: 4, measuredPosts: 3, views: 3_100_000_000, likes: 32, replies: 11, updatedAt: "2026-10-23T00:00:00.000Z",
      });
      assert.deepEqual(report.platforms, {
        threads: { posts: 2, measuredPosts: 1, views: 1_500_000_000, likes: 10, replies: 4, updatedAt: "2026-10-21T12:00:00.000Z" },
        x: { posts: 3, measuredPosts: 3, views: 1_600_000_000, likes: 22, replies: 7, updatedAt: "2026-10-23T00:00:00.000Z" },
      });
      const cross = report.posts.find((post) => post.id === draftId)!;
      assert.equal(cross.text, "Cross-post Threads text");
      assert.equal(cross.publishedAt, "2020-01-01T00:01:00.000Z");
      assert.equal(cross.totals.posts, 1);
      assert.equal(cross.totals.measuredPosts, 1);
      assert.equal(cross.totals.views, 3_100_000_000);
      assert.equal(cross.platforms.threads?.views, 1_500_000_000, "latest snapshot ID breaks equal-time ties");
      assert.equal(cross.platforms.x?.permalink, "https://x.com/cross");
    });

    await t.test("missing latest counters remain unknown and real zeros remain zero", async () => {
      const report = await publicationStatsReport();
      const unmeasured = report.posts.find((post) => post.id === unmeasuredId)!;
      assert.deepEqual(unmeasured.totals, { ...empty, posts: 1 });
      assert.equal(unmeasured.platforms.x, undefined);
      const unknown = report.posts.find((post) => post.id === unknownViewsId)!;
      assert.equal(unknown.totals.views, null, "do not substitute older counters for a missing latest value");
      assert.equal(unknown.totals.likes, 2);
      assert.equal(unknown.totals.measuredPosts, 1);
      const zero = report.posts.find((post) => post.id === zeroId)!;
      assert.equal(zero.totals.views, 0);
      assert.equal(zero.totals.likes, 0);
      assert.equal(zero.totals.replies, 0);
      assert.equal(zero.totals.measuredPosts, 1);
    });

    await t.test("pagination has a stable tie-breaker and never narrows the global totals", async () => {
      const first = await publicationStatsReport(1, 0);
      const second = await publicationStatsReport(1, 1);
      const beyond = await publicationStatsReport(1, 100);
      assert.equal(first.posts[0]?.id, unknownViewsId);
      assert.equal(second.posts[0]?.id, unmeasuredId);
      assert.equal(first.totalPosts, 4);
      assert.equal(second.totalPosts, 4);
      assert.deepEqual(second.totals, first.totals);
      assert.deepEqual(second.platforms, first.platforms);
      assert.deepEqual(beyond.posts, []);
      assert.deepEqual(beyond.totals, first.totals);
      const clamped = await publicationStatsReport(999, -3);
      assert.equal(clamped.limit, 100);
      assert.equal(clamped.offset, 0);
    });

    await t.test("GET endpoint returns the report and validates pagination bounds", async () => {
      const app = Fastify();
      registerAnalyticsRoutes(app, "/api");
      try {
        const response = await app.inject({ method: "GET", url: "/api/analytics/publications?limit=1&offset=1" });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), await publicationStatsReport(1, 1));
        const invalid = await app.inject({ method: "GET", url: "/api/analytics/publications?limit=oops&offset=-4" });
        assert.equal(invalid.statusCode, 200);
        assert.equal(invalid.json().limit, 20);
        assert.equal(invalid.json().offset, 0);
      } finally {
        await app.close();
      }
    });
  } finally {
    setPoolForTests(null);
    setEnvForTests(null);
    await pool.end();
  }
});
