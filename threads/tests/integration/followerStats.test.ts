import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import Fastify from "fastify";
import { query, setPoolForTests } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { loadEnv, setEnvForTests } from "../../src/config/env.js";
import { defaultSettings, invalidateSettingsCache } from "../../src/config/settings.js";
import { setPlatformForTests, type AccountFollowerMetrics, type PlatformAdapter, type PlatformId } from "../../src/platforms/index.js";
import { threadsAdapter } from "../../src/platforms/threads.js";
import { xAdapter } from "../../src/platforms/x.js";
import { captureFollowers, followerStatsReport } from "../../src/services/analytics/followers.js";
import { registerAnalyticsRoutes } from "../../src/api/routes/analytics.js";

test("follower statistics persist account identities, exact growth and failures", {
  skip: process.env.FOLLOWER_STATS_TEST !== "1", timeout: 60_000,
}, async t => {
  const connectionString = process.env.DATABASE_URL!;
  assert.match(new URL(connectionString).pathname, /^\/threads_followers_test_[a-z0-9_]+$/, "requires an isolated follower test database");
  setEnvForTests(loadEnv({ ...process.env, NODE_ENV: "test", REDIS_URL: "redis://localhost:6379/15" }));
  const pool = new pg.Pool({ connectionString });
  setPoolForTests(pool);
  const settings = defaultSettings();
  settings.platforms.threads.enabled = true;
  settings.platforms.x.enabled = true;
  function adapter(id: PlatformId, identity: string, followerMetrics: () => Promise<AccountFollowerMetrics>): PlatformAdapter {
    return {
      ...(id === "threads" ? threadsAdapter : xAdapter), configured: () => true,
      me: async () => ({ id: identity, username: identity }), followerMetrics,
    };
  }
  const count = async (table: string) => (await query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0]!.n;
  try {
    await runMigrations();
    await query("TRUNCATE follower_snapshots, follower_collection_state");
    await query("INSERT INTO settings(key, value) VALUES ('app', $1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(settings)]);
    invalidateSettingsCache();

    await t.test("empty report and GET endpoint return unknown counts", async () => {
      const app = Fastify();
      registerAnalyticsRoutes(app, "/api");
      try {
        const response = await app.inject({ method: "GET", url: "/api/analytics/followers" });
        assert.equal(response.statusCode, 200);
        const report = response.json();
        assert.equal(report.platforms.threads.followers, null);
        assert.equal(report.platforms.x.followers, null);
        assert.equal(report.total.followers, null);
      } finally { await app.close(); }
    });

    await t.test("SQL uses current account, newest baselines, exact zero and 6-hour tolerance", async () => {
      await query(`INSERT INTO follower_collection_state(platform,account_id,username,attempted_at) VALUES
        ('threads','new','new-account','2020-10-23T12:00:00Z'), ('x','x-owner','x-owner','2020-10-23T12:00:00Z')`);
      await query(`INSERT INTO follower_snapshots(platform,account_id,username,followers,approximate,captured_at) VALUES
        ('threads','old','old-account',9999,false,'2020-10-23T13:00:00Z'),
        ('threads','new','new-account',70,true,'2020-09-01T12:00:00Z'),
        ('threads','new','new-account',80,false,'2020-09-02T12:00:00Z'),
        ('threads','new','new-account',90,false,'2020-09-23T05:59:59Z'),
        ('threads','new','new-account',100,false,'2020-10-16T06:00:00Z'),
        ('threads','new','new-account',130,false,'2020-10-22T11:00:00Z'),
        ('threads','new','new-account',140,false,'2020-10-22T12:00:00Z'),
        ('threads','new','new-account',999,false,'2020-10-22T12:00:01Z'),
        ('threads','new','new-account',150,false,'2020-10-23T12:00:00Z'),
        ('x','x-owner','x-owner',2,false,'2020-09-01T12:00:00Z'),
        ('x','x-owner','x-owner',1,false,'2020-10-22T12:00:00Z'),
        ('x','x-owner','x-owner',0,false,'2020-10-23T12:00:00Z')`);
      const report = await followerStatsReport();
      assert.equal(report.platforms.threads.followers, 150);
      assert.equal(report.platforms.threads.trackingSince, "2020-09-01T12:00:00.000Z");
      assert.deepEqual(report.platforms.threads.changes, { day: 10, week: 50, month: null, sinceStart: null });
      assert.equal(report.platforms.x.followers, 0);
      assert.equal(report.total.followers, 150);
      assert.deepEqual(report.total.changes, { day: 9, week: null, month: null, sinceStart: null });
    });

    await t.test("a permission failure retains old valid count while other platform succeeds", async () => {
      const before = await count("follower_snapshots");
      setPlatformForTests("threads", adapter("threads", "new", async () => { throw new Error("denied access_token=secret-value"); }));
      setPlatformForTests("x", adapter("x", "X-OWNER", async () => ({ accountId: "x-owner", username: "X-OWNER", followers: 3, approximate: false })));
      const result = await captureFollowers();
      assert.equal(result.captured, 1);
      assert.equal(result.skipped, 1);
      assert.doesNotMatch(result.error!, /secret-value/);
      assert.equal(await count("follower_snapshots"), before + 1);
      const report = await followerStatsReport();
      assert.equal(report.platforms.threads.followers, 150);
      assert.equal(report.platforms.threads.updatedAt, "2020-10-23T12:00:00.000Z");
      assert.match(report.platforms.threads.error!, /\[redacted\]/);
      assert.equal(report.platforms.x.followers, 3);
      assert.equal(report.platforms.x.error, null);
    });

    await t.test("new account with failed counter never inherits old account's followers", async () => {
      setPlatformForTests("threads", adapter("threads", "third", async () => { throw new Error("no follower permission"); }));
      await captureFollowers();
      const report = await followerStatsReport();
      assert.equal(report.platforms.threads.username, "third");
      assert.equal(report.platforms.threads.followers, null);
      assert.equal(report.platforms.threads.trackingSince, null);
      assert.deepEqual(report.platforms.threads.changes, { day: null, week: null, month: null, sinceStart: null });
      assert.equal(report.total.followers, null);
    });

    await t.test("contradictory identities and invalid counters never create snapshots", async () => {
      const before = await count("follower_snapshots");
      setPlatformForTests("threads", adapter("threads", "third", async () => ({ accountId: "wrong", username: "wrong", followers: 999, approximate: false })));
      setPlatformForTests("x", adapter("x", "x-owner", async () => ({ accountId: "x-owner", username: "x-owner", followers: -1, approximate: false })));
      const result = await captureFollowers();
      assert.equal(result.captured, 0);
      assert.equal(result.skipped, 2);
      assert.equal(await count("follower_snapshots"), before);
      assert.equal((await followerStatsReport()).platforms.threads.followers, null);
    });
  } finally {
    setPlatformForTests("threads", null);
    setPlatformForTests("x", null);
    setPoolForTests(null);
    setEnvForTests(null);
    invalidateSettingsCache();
    await pool.end();
  }
});
