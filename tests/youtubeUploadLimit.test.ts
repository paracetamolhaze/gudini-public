import { test } from "node:test";
import assert from "node:assert/strict";
import { youtubeUploadError } from "../lib/publish";

// загрузки OWNER CRYPTO на момент отказа 31.10 09:12 по Кызылорде
const uploads = [
  "2026-10-31T03:43:12Z", "2026-10-30T14:13:43Z", "2026-10-30T13:13:08Z", "2026-10-30T13:10:57Z",
  "2026-10-30T12:54:16Z", "2026-10-30T12:25:18Z", "2026-10-30T11:05:06Z", "2026-10-30T09:28:01Z",
  "2026-10-30T07:19:20Z", "2026-10-30T06:14:56Z", "2026-10-30T02:10:43Z", "2026-10-30T01:32:16Z",
];
const limitBody = JSON.stringify({ error: { code: 400, errors: [{ domain: "youtube.video", reason: "uploadLimitExceeded" }] } });

test("upload limit names the channel's uploads and when to retry", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) =>
    String(url).includes("/channels")
      ? Response.json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] })
      : Response.json({ items: uploads.map((publishedAt) => ({ snippet: { publishedAt } })) })) as typeof fetch;
  try {
    const message = await youtubeUploadError("t", 400, limitBody, Date.parse("2026-10-31T04:12:16Z"));
    assert.match(message, /суточный лимит загрузок/);
    assert.match(message, /загружено 10 видео/);
    assert.match(message, /после 31\.10 в 12:00/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upload limit without channel history still says when to retry", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  try {
    const message = await youtubeUploadError("t", 400, limitBody, Date.parse("2026-10-31T04:12:16Z"));
    assert.doesNotMatch(message, /загружено/);
    assert.match(message, /после 31\.10 в 12:00/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("other YouTube errors stay as YouTube sent them", async () => {
  assert.equal(await youtubeUploadError("t", 403, "forbidden"), "YouTube API: 403 forbidden");
});
