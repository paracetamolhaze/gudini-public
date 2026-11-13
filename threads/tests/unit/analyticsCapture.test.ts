import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { loadEnv, setEnvForTests } from "../../src/config/env.js";
import { defaultSettings, invalidateSettingsCache } from "../../src/config/settings.js";
import { setPoolForTests } from "../../src/db/pool.js";
import { setPlatformForTests, type PlatformAdapter, type PlatformId } from "../../src/platforms/index.js";
import { threadsAdapter } from "../../src/platforms/threads.js";
import { xAdapter } from "../../src/platforms/x.js";
import { captureInsights } from "../../src/services/analytics/insights.js";
import { PermissionError } from "../../src/threads/errors.js";

setEnvForTests(loadEnv({ DATABASE_URL: "postgres://unused", REDIS_URL: "redis://unused", NODE_ENV: "test" }));

const counters = { views: null, likes: 4, replies: 2, reposts: 1, quotes: 0, shares: 0 };
type Publication = { id: string; platform: PlatformId; platform_post_id: string };

function fixture(t: TestContext, rows: Publication[], enabled: PlatformId[]) {
  const settings = defaultSettings();
  settings.platforms.threads.enabled = enabled.includes("threads");
  settings.platforms.x.enabled = enabled.includes("x");
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  setPoolForTests({ async query(sql: string, params: unknown[] = []) {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT value FROM settings")) return { rows: [{ value: settings }], rowCount: 1 };
    if (sql.startsWith("WITH eligible")) return { rows, rowCount: rows.length };
    return { rows: [], rowCount: 1 };
  } } as unknown as pg.Pool);
  invalidateSettingsCache();
  t.after(() => {
    setPoolForTests(null);
    setPlatformForTests("threads", null);
    setPlatformForTests("x", null);
    invalidateSettingsCache();
  });
  return calls;
}

function adapter(id: PlatformId, metrics: PlatformAdapter["metrics"]): PlatformAdapter {
  return { ...(id === "threads" ? threadsAdapter : xAdapter), configured: () => true, metrics };
}

test("all-time collection limits eligible connected platforms before batching and persists unknown views", async t => {
  const calls = fixture(t, [{ id: "old-post", platform: "x", platform_post_id: "123" }], ["x"]);
  const fetched: string[] = [];
  setPlatformForTests("x", adapter("x", async id => { fetched.push(id); return counters; }));
  assert.deepEqual(await captureInsights(), { captured: 1, skipped: 0, error: null });
  assert.deepEqual(fetched, ["123"]);
  const selection = calls.find(c => c.sql.startsWith("WITH eligible"))!;
  assert.deepEqual(selection.params, [["x"]]);
  assert.match(selection.sql, /p\.dry_run = false AND p\.platform = ANY\(\$1::text\[\]\)/);
  assert.match(selection.sql, /latest\.captured_at < now\(\) - interval '2 hours'/);
  assert.doesNotMatch(selection.sql, /published_at >=|snapshotDays|make_interval/);
  assert.match(selection.sql, /GREATEST\(latest\.captured_at, p\.insights_attempted_at\) AS last_checked_at/);
  assert.match(selection.sql, /PARTITION BY platform ORDER BY last_checked_at ASC NULLS FIRST/);
  assert.match(selection.sql, /ORDER BY platform_rank, platform LIMIT 40/);
  const snapshot = calls.find(c => c.sql.startsWith("INSERT INTO insight_snapshots"))!;
  assert.deepEqual(snapshot.params, ["old-post", "x", "123", null, 4, 2, 1, 0, 0]);
});

test("a platform permission refusal blocks only that platform for the round", async t => {
  const calls = fixture(t, [
    { id: "t1", platform: "threads", platform_post_id: "1" },
    { id: "x1", platform: "x", platform_post_id: "2" },
    { id: "t2", platform: "threads", platform_post_id: "3" },
    { id: "x2", platform: "x", platform_post_id: "4" },
  ], ["threads", "x"]);
  let threadCalls = 0;
  setPlatformForTests("threads", adapter("threads", async () => {
    threadCalls++;
    throw new PermissionError("denied", 403, "/insights", undefined, "threads_manage_insights");
  }));
  setPlatformForTests("x", adapter("x", async () => counters));
  const result = await captureInsights();
  assert.equal(result.captured, 2);
  assert.equal(result.skipped, 2);
  assert.match(result.error ?? "", /threads_manage_insights/);
  assert.equal(threadCalls, 1);
  assert.deepEqual(calls.filter(c => c.sql.startsWith("INSERT INTO insight_snapshots")).map(c => c.params[0]), ["x1", "x2"]);
  assert.deepEqual(calls.filter(c => c.sql.startsWith("UPDATE publications SET insights_attempted_at")).map(c => c.params[0]), ["t1", "x1", "x2"]);
});

test("failed post attempts are recorded before the external read without fabricating a snapshot", async t => {
  const calls = fixture(t, [
    { id: "deleted", platform: "x", platform_post_id: "100" },
    { id: "valid", platform: "x", platform_post_id: "200" },
  ], ["x"]);
  const fetched: string[] = [];
  setPlatformForTests("x", adapter("x", async id => {
    const publicationId = id === "100" ? "deleted" : "valid";
    assert.equal(calls.at(-1)?.sql, "UPDATE publications SET insights_attempted_at = now() WHERE id = $1");
    assert.deepEqual(calls.at(-1)?.params, [publicationId]);
    fetched.push(id);
    if (id === "100") throw new Error("post deleted");
    return counters;
  }));
  assert.deepEqual(await captureInsights(), { captured: 1, skipped: 1, error: null });
  assert.deepEqual(fetched, ["100", "200"]);
  assert.deepEqual(calls.filter(c => c.sql.startsWith("UPDATE publications SET insights_attempted_at")).map(c => c.params[0]), ["deleted", "valid"]);
  assert.deepEqual(calls.filter(c => c.sql.startsWith("INSERT INTO insight_snapshots")).map(c => c.params[0]), ["valid"]);
});

test("no configured platform skips querying publications and writing snapshots", async t => {
  const calls = fixture(t, [], ["threads", "x"]);
  setPlatformForTests("threads", { ...adapter("threads", async () => counters), configured: () => false });
  setPlatformForTests("x", { ...adapter("x", async () => counters), configured: () => false });
  assert.deepEqual(await captureInsights(), { captured: 0, skipped: 0, error: "no platform connected" });
  assert.equal(calls.length, 1);
});
