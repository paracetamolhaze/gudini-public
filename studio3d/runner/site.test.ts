import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fakeSite, type Answer } from "./fakeSite";
import { MAX_CLIP_BYTES, type VoicePlan } from "./protocol";
import { createSite, SiteError } from "./site";

const quick = { password: "секрет", retryDelaysMs: [5, 5, 5] };

test("JSON calls retry a dropped connection and a 5xx, with Basic auth of the worker", async () => {
  const site = await fakeSite((_req, all) => (all.length === 1 ? "drop" : all.length === 2 ? { status: 503 } : { status: 200, body: { job: null } }));
  try {
    const claimed = await createSite({ ...quick, url: site.url }).claim();
    assert.equal(claimed, null);
    assert.equal(site.calls("/api/3d/runner/claim").length, 3);
    assert.equal(site.seen[2].headers.authorization, "Basic " + Buffer.from("worker:секрет").toString("base64"));
  } finally {
    await site.close();
  }
});

test("a 4xx is not retried and keeps the status", async () => {
  const site = await fakeSite(() => ({ status: 409, body: { error: "задание уже не ваше" } }));
  try {
    await assert.rejects(
      createSite({ ...quick, url: site.url }).progress({ id: "p1", jobId: "j1", step: "шаг", progress: 5 }),
      (error: unknown) => error instanceof SiteError && error.status === 409 && /задание уже не ваше/.test(error.message),
    );
    assert.equal(site.seen.length, 1);
  } finally {
    await site.close();
  }
});

test("the video upload resumes from { received } after a 409 and survives a 5xx", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-site-"));
  const file = path.join(dir, "out.mp4");
  const video = randomBytes(2500);
  await fs.writeFile(file, video);
  let part = Buffer.alloc(0);
  let lostTail = false;
  let failedOnce = false;
  // Behaves like the site's chunk route, except that it once loses the tail of what it confirmed and once fails.
  const site = await fakeSite(req => {
    const offset = Number(req.headers["x-offset"]);
    const total = Number(req.headers["x-file-size"]);
    if (offset === 1600 && !failedOnce) {
      failedOnce = true;
      return { status: 503, body: { error: "перезапуск" } };
    }
    if (offset === 0) part = Buffer.from(req.raw);
    else if (offset === part.length) part = Buffer.concat([part, req.raw]);
    else return { status: 409, body: { error: "рассинхрон", received: part.length } };
    const received = part.length;
    if (!lostTail && received === 1000) {
      lostTail = true;
      part = part.subarray(0, 600);
    }
    if (received >= total) return { status: 200, body: { done: true, size: received } };
    return { status: 200, body: { ok: true, received } };
  });
  try {
    await createSite({ ...quick, url: site.url, chunkBytes: 1000 }).uploadVideo("p1", "job/1", file);
    assert.deepEqual(part, video);
    const offsets = site.seen.map(req => Number(req.headers["x-offset"]));
    assert.deepEqual(offsets, [0, 1000, 600, 1600, 1600]);
    assert.ok(site.seen.every(req => req.method === "PUT" && req.path === "/api/3d/runner/video/p1" && req.query.get("jobId") === "job/1"));
    assert.ok(site.seen.every(req => req.headers["x-file-size"] === "2500"));
  } finally {
    await site.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a 409 without { received } ends the upload: the job is no longer ours", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-site-"));
  const file = path.join(dir, "out.mp4");
  await fs.writeFile(file, randomBytes(1500));
  const site = await fakeSite(() => ({ status: 409, body: { error: "задание отдано другому" } }));
  try {
    await assert.rejects(
      createSite({ ...quick, url: site.url, chunkBytes: 1000 }).uploadVideo("p1", "j1", file),
      (error: unknown) => error instanceof SiteError && error.status === 409,
    );
    assert.equal(site.seen.length, 1);
  } finally {
    await site.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("claim hands over the voice plan with the job; a claim without one stays as it was", async () => {
  const now = new Date().toISOString();
  const project = { id: "p1", createdAt: now, updatedAt: now, topic: "т", script: null, scriptVersion: 1, job: null, video: null };
  const job = { id: "j1", task: "voice", state: "running", step: "", progress: 0, createdAt: now };
  const voice: VoicePlan = { keys: ["a", "b"], ownVoice: false, dubVersion: 2, lines: [] };
  let n = 0;
  const site = await fakeSite(() => ({ status: 200, body: ++n === 1 ? { project, job, voice } : { project, job } }));
  try {
    const client = createSite({ ...quick, url: site.url });
    assert.deepEqual((await client.claim())?.voice, voice);
    const old = await client.claim();
    assert.equal(old?.job.id, "j1");
    assert.equal(old && "voice" in old, false);
  } finally {
    await site.close();
  }
});

test("a recorded take is saved only when its bytes are the planned ones: a cut body and a 5xx are fetched again", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-site-"));
  const dest = path.join(dir, "take.flac");
  const take = randomBytes(3000);
  const site = await fakeSite((_req, all): Answer => {
    if (all.length === 1) return { status: 200, raw: take.subarray(0, 1000), headers: { "x-sha256": sha(take) } };
    if (all.length === 2) return { status: 502, body: { error: "перезапуск" } };
    return { status: 200, raw: take, headers: { "x-sha256": sha(take), "Content-Type": "audio/flac" } };
  });
  try {
    await createSite({ ...quick, url: site.url }).downloadDub("p1", "job/1", "ключ 1", 4, dest, { sha256: sha(take).toUpperCase(), bytes: take.length });
    assert.deepEqual(await fs.readFile(dest), take);
    assert.equal(site.seen.length, 3);
    assert.ok(site.seen.every(req => req.method === "GET" && req.path === "/api/3d/runner/dub/p1/" + encodeURIComponent("ключ 1")));
    assert.ok(site.seen.every(req => req.query.get("jobId") === "job/1" && req.query.get("take") === "4"));
    assert.equal(site.seen[0].headers.authorization, "Basic " + Buffer.from("worker:секрет").toString("base64"));
    assert.deepEqual(await fs.readdir(dir), ["take.flac"], "без недокачанных хвостов");
  } finally {
    await site.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a take the site re-recorded after the plan is refused at once; a 409 ends the download as a lost job", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-site-"));
  const dest = path.join(dir, "take.flac");
  const planned = randomBytes(500);
  const newer = randomBytes(500);
  const site = await fakeSite(req => (req.query.get("take") === "1" ? { status: 200, raw: newer, headers: { "x-sha256": sha(newer) } } : { status: 409, body: { error: "монтаж уже не идёт" } }));
  try {
    const client = createSite({ ...quick, url: site.url });
    await assert.rejects(client.downloadDub("p1", "j1", "k", 1, dest, { sha256: sha(planned) }), /уже другая.*запустите монтаж снова/);
    assert.equal(site.seen.length, 1);
    await assert.rejects(client.downloadDub("p1", "j1", "k", 2, dest, { sha256: sha(planned) }), (error: unknown) => error instanceof SiteError && error.status === 409);
    assert.equal(site.seen.length, 2);
    await assert.rejects(fs.stat(dest));
  } finally {
    await site.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a take that never arrives whole fails after the retries with a Russian reason", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-site-"));
  const take = randomBytes(800);
  const site = await fakeSite(() => ({ status: 200, raw: take.subarray(1), headers: { "x-sha256": sha(take) } }));
  try {
    await assert.rejects(createSite({ ...quick, url: site.url }).downloadDub("p1", "j1", "k", 1, path.join(dir, "t.flac"), { sha256: sha(take) }), /повреждённой/);
    assert.equal(site.seen.length, 4);
  } finally {
    await site.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a voiced line goes up whole as audio/mpeg with its duration; one too big is refused before sending", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio3d-site-"));
  const file = path.join(dir, "line.mp3");
  const big = path.join(dir, "big.mp3");
  const clip = randomBytes(1200);
  await fs.writeFile(file, clip);
  await fs.writeFile(big, Buffer.alloc(MAX_CLIP_BYTES + 1));
  const site = await fakeSite((_req, all) => (all.length === 1 ? { status: 503 } : { status: 200, body: { ok: true } }));
  try {
    const client = createSite({ ...quick, url: site.url });
    await client.uploadClip("p1", "j1", "k/1", file, 2.34567);
    assert.equal(site.seen.length, 2);
    const [, put] = site.seen;
    assert.equal(put.method, "PUT");
    assert.equal(put.path, "/api/3d/runner/clip/p1/" + encodeURIComponent("k/1"));
    assert.equal(put.query.get("jobId"), "j1");
    assert.equal(put.query.get("duration"), "2.346");
    assert.equal(put.headers["content-type"], "audio/mpeg");
    assert.deepEqual(put.raw, clip);
    await assert.rejects(client.uploadClip("p1", "j1", "k", big, 1), /больше 5 МБ/);
    await assert.rejects(client.uploadClip("p1", "j1", "k", file, 0), /без длительности/);
    assert.equal(site.seen.length, 2);
  } finally {
    await site.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
