import test from "node:test";
import assert from "node:assert/strict";
import { ThreadsClient } from "../../src/threads/client.js";
import { XClient, type XUsageKind } from "../../src/x/client.js";
import { PermissionError, ThreadsError } from "../../src/threads/errors.js";
import { setThreadsClientForTests } from "../../src/threads/index.js";
import { setXClientForTests } from "../../src/x/index.js";
import { threadsAdapter } from "../../src/platforms/threads.js";
import { xAdapter } from "../../src/platforms/x.js";

function fakeFetch(handler: (url: URL, init: RequestInit | undefined) => { status?: number; body: unknown }): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const threadsClient = (fetchImpl: typeof fetch) => new ThreadsClient({ accessToken: "test-token", userId: "42", minRequestIntervalMs: 0, maxRetries: 0, fetchImpl });
const credentials = { consumerKey: "ck", consumerSecret: "cs", accessToken: "at", accessSecret: "as" };
type Usage = [XUsageKind, number, Record<string, unknown> | undefined];
const xClient = (fetchImpl: typeof fetch, usage: Usage[] = []) => new XClient({ credentials, fetchImpl, minRequestIntervalMs: 0, maxRetries: 0, onUsage: (kind, units, meta) => usage.push([kind, units, meta]) });

test("Threads followers read the named account total, including zero, without historical parameters", async () => {
  for (const count of [0, 1602, Number.MAX_SAFE_INTEGER]) {
    let requests = 0;
    const client = threadsClient(fakeFetch((url, init) => {
      requests++;
      assert.equal(init?.method, "GET");
      assert.equal(url.pathname, "/v1.0/42/threads_insights");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["access_token", "metric"]);
      assert.equal(url.searchParams.get("metric"), "followers_count");
      return { body: { data: [
        { name: "likes", total_value: { value: 9999 } },
        { name: "followers_count", period: "lifetime", total_value: { value: count } },
      ] } };
    }));
    assert.equal(await client.followersCount(), count);
    assert.equal(requests, 1);
  }
});

test("Threads missing or invalid follower totals are rejected instead of becoming zero", async () => {
  const missing = [
    {}, { data: [] }, { data: [{ name: "likes", total_value: { value: 10 } }] },
    { data: [{ name: "followers_count" }] },
    { data: [{ name: "followers_count", values: [{ value: 1602 }] }] },
  ];
  const invalid = [null, "1602", true, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]
    .map((value) => ({ data: [{ name: "followers_count", total_value: { value } }] }));
  for (const body of [...missing, ...invalid]) {
    await assert.rejects(threadsClient(fakeFetch(() => ({ body }))).followersCount(), (err: unknown) => {
      assert.ok(err instanceof ThreadsError);
      assert.match(err.message, /число подписчиков/);
      return true;
    }, JSON.stringify(body));
  }
});

test("Threads adapter binds an exact zero total to the current profile identity", async () => {
  const paths: string[] = [];
  const client = new ThreadsClient({ accessToken: "test-token", userId: "99", minRequestIntervalMs: 0, maxRetries: 0,
    fetchImpl: fakeFetch((url) => {
      paths.push(url.pathname);
      return { body: url.pathname.endsWith("/me")
        ? { id: "42", username: "current_owner", name: "Owner" }
        : { data: [{ name: "followers_count", total_value: { value: 0 } }] } };
    }),
  });
  setThreadsClientForTests(client);
  try {
    assert.deepEqual(await threadsAdapter.followerMetrics!(), { accountId: "42", username: "current_owner", followers: 0, approximate: false });
    assert.deepEqual(paths, ["/v1.0/me", "/v1.0/42/threads_insights"]);
  } finally {
    setThreadsClientForTests(null);
  }
});

test("Threads insight permission errors remain errors", async () => {
  const client = threadsClient(fakeFetch(() => ({ status: 400, body: { error: { message: "Permission denied", code: 10 } } })));
  await assert.rejects(client.followersCount(), PermissionError);
});

test("X follower totals request public_metrics and record the paid read, including zero", async () => {
  for (const count of [0, 1602, Number.MAX_SAFE_INTEGER]) {
    const usage: Usage[] = [];
    const client = xClient(fakeFetch((url, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(url.pathname, "/2/users/me");
      assert.deepEqual([...url.searchParams.keys()], ["user.fields"]);
      assert.deepEqual(url.searchParams.get("user.fields")?.split(",").sort(), ["public_metrics", "username"]);
      assert.match((init?.headers as Record<string, string>).authorization!, /^OAuth /);
      return { body: { data: { id: "42", username: "current_owner", public_metrics: { followers_count: count, following_count: 99 } } } };
    }), usage);
    client.seedIdentity({ id: "old-account", username: "old_owner" });
    assert.deepEqual(await client.followers(), { id: "42", username: "current_owner", followers: count });
    assert.deepEqual(usage, [["user_read", 1, { endpoint: "users/me", metric: "followers_count" }]]);
  }
});

test("X missing identities or invalid follower counts are rejected and successful reads remain accounted for", async () => {
  const missing = [
    {}, { data: {} }, { data: { id: "42", username: "owner" } },
    { data: { id: "42", username: "owner", public_metrics: { following_count: 100 } } },
    { data: { username: "owner", public_metrics: { followers_count: 100 } } },
    { data: { id: "42", public_metrics: { followers_count: 100 } } },
  ];
  const invalid = [null, "1602", true, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]
    .map((value) => ({ data: { id: "42", username: "owner", public_metrics: { followers_count: value } } }));
  for (const body of [...missing, ...invalid]) {
    const usage: Usage[] = [];
    await assert.rejects(xClient(fakeFetch(() => ({ body })), usage).followers(), (err: unknown) => {
      assert.ok(err instanceof ThreadsError);
      assert.match(err.message, /число подписчиков/);
      return true;
    }, JSON.stringify(body));
    assert.equal(usage.length, 1);
    assert.equal(usage[0]?.[0], "user_read");
  }
});

test("X adapter exposes the profile total as an exact account observation", async () => {
  setXClientForTests(xClient(fakeFetch(() => ({ body: { data: { id: "42", username: "owner", public_metrics: { followers_count: 1602 } } } }))));
  try {
    assert.deepEqual(await xAdapter.followerMetrics!(), { accountId: "42", username: "owner", followers: 1602, approximate: false });
  } finally {
    setXClientForTests(null);
  }
});

test("X follower permission errors do not yield a fabricated account observation", async () => {
  const usage: Usage[] = [];
  const client = xClient(fakeFetch(() => ({ status: 403, body: { title: "Forbidden", detail: "Not permitted" } })), usage);
  await assert.rejects(client.followers(), PermissionError);
  assert.deepEqual(usage, []);
});
