import test from "node:test";
import assert from "node:assert/strict";
import { ThreadsClient } from "../../src/threads/client.js";
import { xBrowserAdapter } from "../../src/platforms/xBrowser.js";
import { xAdapter } from "../../src/platforms/x.js";
import { setXBrowserForTests, type XBrowserClient } from "../../src/x/browser/client.js";
import { setXClientForTests, type XClient } from "../../src/x/index.js";

test("Threads distinguishes absent or empty view values from a measured zero", async () => {
  const cases = [
    { values: undefined, expected: null },
    { values: [], expected: null },
    { values: [{}], expected: null },
    { values: [{ value: 0 }], expected: 0 },
    { values: [{ value: 10 }, { value: 2 }], expected: 12 },
  ];
  for (const { values, expected } of cases) {
    const client = new ThreadsClient({
      accessToken: "test", minRequestIntervalMs: 0,
      fetchImpl: async () => new Response(JSON.stringify({ data: [
        { name: "likes", total_value: { value: 7 } },
        { name: "views", values },
      ] }), { headers: { "content-type": "application/json" } }),
    });
    const m = await client.postInsights("123");
    assert.equal(m.views, expected);
    assert.equal(m.likes, 7);
  }
});

test("X browser preserves absent views as null and explicit zero as zero", async t => {
  t.after(() => setXBrowserForTests(null));
  for (const views of [undefined, 0, 25]) {
    setXBrowserForTests({ metrics: async () => ({ metrics: { views, likes: 7, replies: 3 } }) } as unknown as XBrowserClient);
    const m = await xBrowserAdapter.metrics("123");
    assert.equal(m.views, views ?? null);
    assert.equal(m.likes, 7);
    assert.equal(m.replies, 3);
  }
});

test("X API preserves unavailable impressions as null and explicit zero as zero", async t => {
  t.after(() => setXClientForTests(null));
  for (const impression_count of [undefined, 0, 25]) {
    setXClientForTests({ postMetrics: async () => new Map([["123", { impression_count, like_count: 7, reply_count: 3 }]]) } as unknown as XClient);
    const m = await xAdapter.metrics("123");
    assert.equal(m.views, impression_count ?? null);
    assert.equal(m.likes, 7);
    assert.equal(m.replies, 3);
  }
});
