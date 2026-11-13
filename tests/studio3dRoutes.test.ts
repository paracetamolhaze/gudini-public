import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

/**
 * Маршруты /api/3d/* целиком, без сети и без контейнера: временная папка вместо data/,
 * «контейнер» — эти же вызовы раннера. Реальные данные сайта не затрагиваются.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-3d-routes-"));
process.env.STUDIO3D_DATA_DIR = root;

let listRoute: typeof import("../app/api/3d/route");
let itemRoute: typeof import("../app/api/3d/[id]/route");
let runRoute: typeof import("../app/api/3d/[id]/run/route");
let videoRoute: typeof import("../app/api/3d/[id]/video/route");
let claimRoute: typeof import("../app/api/3d/runner/claim/route");
let progressRoute: typeof import("../app/api/3d/runner/progress/route");
let scriptRoute: typeof import("../app/api/3d/runner/script/route");
let completeRoute: typeof import("../app/api/3d/runner/complete/route");
let uploadRoute: typeof import("../app/api/3d/runner/video/[id]/route");
let dubRoute: typeof import("../app/api/3d/[id]/dub/[key]/route");
let clipRoute: typeof import("../app/api/3d/[id]/clip/[key]/route");
let runnerDubRoute: typeof import("../app/api/3d/runner/dub/[id]/[key]/route");
let runnerClipRoute: typeof import("../app/api/3d/runner/clip/[id]/[key]/route");

before(async () => {
  dubRoute = await import("../app/api/3d/[id]/dub/[key]/route");
  clipRoute = await import("../app/api/3d/[id]/clip/[key]/route");
  runnerDubRoute = await import("../app/api/3d/runner/dub/[id]/[key]/route");
  runnerClipRoute = await import("../app/api/3d/runner/clip/[id]/[key]/route");
  listRoute = await import("../app/api/3d/route");
  itemRoute = await import("../app/api/3d/[id]/route");
  runRoute = await import("../app/api/3d/[id]/run/route");
  videoRoute = await import("../app/api/3d/[id]/video/route");
  claimRoute = await import("../app/api/3d/runner/claim/route");
  progressRoute = await import("../app/api/3d/runner/progress/route");
  scriptRoute = await import("../app/api/3d/runner/script/route");
  completeRoute = await import("../app/api/3d/runner/complete/route");
  uploadRoute = await import("../app/api/3d/runner/video/[id]/route");
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

const url = (p: string) => `http://localhost${p}`;
const json = (p: string, method: string, body: unknown) =>
  new NextRequest(url(p), { method, body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const dialog = {
  title: "Крипта: «всё на биткоин»",
  lines: [
    { who: "me", text: "Клод, я всё вложу в биткоин." },
    { who: "claude", text: "[laughs] А на еду что останется?" },
  ],
};

test("полный путь: создание, сценарий, монтаж, видео с перемоткой и скачиванием", async () => {
  // создание
  assert.equal((await listRoute.POST(json("/api/3d", "POST", "{не json"))).status, 400);
  assert.equal((await listRoute.POST(json("/api/3d", "POST", { topic: "ab" }))).status, 400);
  const created = await listRoute.POST(json("/api/3d", "POST", { topic: "Почему не надо всё в биткоин", notes: "смешно" }));
  assert.equal(created.status, 201);
  const { id } = await created.json();

  const list = await (await listRoute.GET()).json();
  assert.equal(list.projects.length, 1);
  assert.equal(list.projects[0].job.state, "queued");
  assert.equal(list.projects[0].job.lost, false);

  assert.equal((await itemRoute.GET(new NextRequest(url("/api/3d/x")), ctx("../x"))).status, 400);
  assert.equal((await itemRoute.GET(new NextRequest(url("/api/3d/nope")), ctx("nope-123"))).status, 404);
  assert.equal((await itemRoute.PATCH(json(`/api/3d/${id}`, "PATCH", { topic: "Новая тема" }), ctx(id))).status, 409);

  // контейнер пишет сценарий
  const claim = await (await claimRoute.POST()).json();
  assert.equal(claim.project.id, id);
  assert.equal(claim.job.task, "script");
  assert.deepEqual(await (await claimRoute.POST()).json(), { job: null });
  const wrong = await progressRoute.POST(json("/api/3d/runner/progress", "POST", { id, jobId: "other-job", step: "x", progress: 5 }));
  assert.equal(wrong.status, 409);
  assert.equal((await progressRoute.POST(json("/api/3d/runner/progress", "POST", { id, jobId: claim.job.id, step: "Пишу", progress: 40 }))).status, 200);
  const badScript = await scriptRoute.POST(json("/api/3d/runner/script", "POST", { id, jobId: claim.job.id, script: { title: "", lines: [dialog.lines[0]] } }));
  assert.equal(badScript.status, 400);
  const okScript = await scriptRoute.POST(json("/api/3d/runner/script", "POST", { id, jobId: claim.job.id, script: dialog }));
  assert.deepEqual(await okScript.json(), { ok: true, scriptVersion: 1 });
  assert.equal((await completeRoute.POST(json("/api/3d/runner/complete", "POST", { id, jobId: claim.job.id }))).status, 200);

  // владелец правит и запускает монтаж
  const patched = await itemRoute.PATCH(json(`/api/3d/${id}`, "PATCH", { script: { ...dialog, lines: [...dialog.lines, { who: "me", text: "Ладно, половину." }] } }), ctx(id));
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).scriptVersion, 2);
  assert.equal((await runRoute.POST(json(`/api/3d/${id}/run`, "POST", { task: "dance" }), ctx(id))).status, 400);
  const run = await runRoute.POST(json(`/api/3d/${id}/run`, "POST", { task: "montage" }), ctx(id));
  assert.equal(run.status, 200);
  assert.equal((await run.json()).job.task, "montage");
  assert.equal((await runRoute.POST(json(`/api/3d/${id}/run`, "POST", { task: "montage" }), ctx(id))).status, 409);

  // загрузка видео кусками
  const montage = await (await claimRoute.POST()).json();
  const file = Buffer.from("fake-mp4-0123456789");
  const put = (offset: number, chunk: Buffer, jobId = montage.job.id, size = file.length) =>
    uploadRoute.PUT(
      new NextRequest(url(`/api/3d/runner/video/${id}?jobId=${jobId}`), {
        method: "PUT",
        body: new Uint8Array(chunk),
        headers: { "Content-Type": "application/octet-stream", "x-offset": String(offset), "x-file-size": String(size) },
      }),
      ctx(id),
    );
  assert.equal((await uploadRoute.PUT(new NextRequest(url(`/api/3d/runner/video/${id}?jobId=${montage.job.id}`), { method: "PUT", body: "x" }), ctx(id))).status, 400);
  const notMine = await put(0, file.subarray(0, 5), "other-job");
  assert.equal(notMine.status, 409);
  assert.equal((await notMine.json()).received, undefined, "чужой задаче не предлагаем продолжить");
  assert.equal((await put(0, file, montage.job.id, 3 * 1024 ** 3)).status, 413);
  assert.deepEqual(await (await put(0, file.subarray(0, 8))).json(), { ok: true, received: 8 });
  const resync = await put(12, file.subarray(12));
  assert.equal(resync.status, 409);
  assert.equal((await resync.json()).received, 8);
  assert.deepEqual(await (await put(8, file.subarray(8))).json(), { done: true, size: file.length });

  const done = await completeRoute.POST(json("/api/3d/runner/complete", "POST", { id, jobId: montage.job.id, video: { duration: 12.5, scriptVersion: 2 } }));
  assert.equal(done.status, 200);
  const project = await (await itemRoute.GET(new NextRequest(url(`/api/3d/${id}`)), ctx(id))).json();
  assert.equal(project.job.state, "done");
  assert.equal(project.video.scriptVersion, 2);

  // отдача видео
  const full = await videoRoute.GET(new NextRequest(url(`/api/3d/${id}/video`)), ctx(id));
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("cache-control"), "private, no-cache");
  assert.equal(Buffer.from(await full.arrayBuffer()).toString(), file.toString());
  const ranged = await videoRoute.GET(new NextRequest(url(`/api/3d/${id}/video?v=${encodeURIComponent(project.video.at)}`), { headers: { range: "bytes=5-7" } }), ctx(id));
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), `bytes 5-7/${file.length}`);
  assert.equal(ranged.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.equal(Buffer.from(await ranged.arrayBuffer()).toString(), "mp4");
  const tail = await videoRoute.GET(new NextRequest(url(`/api/3d/${id}/video`), { headers: { range: "bytes=-3" } }), ctx(id));
  assert.equal(Buffer.from(await tail.arrayBuffer()).toString(), "789");
  const open = await videoRoute.GET(new NextRequest(url(`/api/3d/${id}/video`), { headers: { range: "bytes=10-" } }), ctx(id));
  assert.equal(open.headers.get("content-length"), String(file.length - 10));
  const beyond = await videoRoute.GET(new NextRequest(url(`/api/3d/${id}/video`), { headers: { range: "bytes=500-" } }), ctx(id));
  assert.equal(beyond.status, 416);
  assert.equal(beyond.headers.get("content-range"), `bytes */${file.length}`);
  const download = await videoRoute.GET(new NextRequest(url(`/api/3d/${id}/video?download=1`)), ctx(id));
  const disposition = download.headers.get("content-disposition") ?? "";
  assert.match(disposition, /^attachment; filename="gudini-3d-[a-z0-9-]+\.mp4"; filename\*=UTF-8''/);
  assert.equal(decodeURIComponent(disposition.split("UTF-8''")[1]), "Крипта всё на биткоин.mp4");

  // удаление
  assert.equal((await itemRoute.DELETE(new NextRequest(url(`/api/3d/${id}`)), ctx(id))).status, 200);
  assert.equal((await videoRoute.GET(new NextRequest(url(`/api/3d/${id}/video`)), ctx(id))).status, 404);
  const late = await progressRoute.POST(json("/api/3d/runner/progress", "POST", { id, jobId: montage.job.id, step: "x", progress: 1 }));
  assert.equal(late.status, 409, "контейнер удалённого проекта останавливается");
});

test("отмена задачи в очереди", async () => {
  const created = await listRoute.POST(json("/api/3d", "POST", { topic: "Отменю сразу" }));
  const { id } = await created.json();
  const cancelled = await runRoute.DELETE(new NextRequest(url(`/api/3d/${id}/run`), { method: "DELETE" }), ctx(id));
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).job, null);
  assert.equal((await runRoute.DELETE(new NextRequest(url(`/api/3d/${id}/run`), { method: "DELETE" }), ctx(id))).status, 409);
  assert.deepEqual(await (await claimRoute.POST()).json(), { job: null });
});

// ---- озвучка своим голосом

function wav(seconds: number, amp = 0.4, rate = 16000): Buffer {
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 330 * i) / rate) * amp * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8, "latin1");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "latin1");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const keyCtx = (id: string, key: string) => ({ params: Promise.resolve({ id, key }) });
const raw = (p: string, method: string, body?: Buffer, headers: Record<string, string> = {}) =>
  new NextRequest(url(p), { method, ...(body ? { body: new Uint8Array(body) } : {}), headers });

test("свой голос: запись реплик, подсказки раннера, монтаж с записями", async () => {
  const { lineKey } = await import("../lib/studio3d/rules");
  const { MAX_DUB_BYTES } = await import("../lib/studio3d/types");
  const script = {
    title: "Свой голос",
    lines: [
      { who: "me", text: "Клод, я записал реплику сам." },
      { who: "claude", text: "[laughs] Звучит почти как я." },
      { who: "me", text: "Почти — не считается." },
    ],
  };
  const [k0, k1, k2] = script.lines.map((l) => lineKey(l.text));

  const created = await listRoute.POST(json("/api/3d", "POST", { topic: "Свой голос в скетче" }));
  const { id } = await created.json();
  const first = await (await claimRoute.POST()).json();
  assert.equal(first.voice, undefined, "сценарию план озвучки не нужен");
  await scriptRoute.POST(json("/api/3d/runner/script", "POST", { id, jobId: first.job.id, script }));
  await completeRoute.POST(json("/api/3d/runner/complete", "POST", { id, jobId: first.job.id }));

  // «Мой голос»
  assert.equal((await itemRoute.PATCH(json(`/api/3d/${id}`, "PATCH", { ownVoice: "yes" }), ctx(id))).status, 400);
  const on = await itemRoute.PATCH(json(`/api/3d/${id}`, "PATCH", { ownVoice: true }), ctx(id));
  assert.equal(on.status, 200);
  assert.equal((await on.json()).ownVoice, true);
  const refused = await runRoute.POST(json(`/api/3d/${id}/run`, "POST", { task: "montage" }), ctx(id));
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /не записаны реплики 1 и 3/);
  const list = await (await listRoute.GET()).json();
  assert.deepEqual(list.projects.find((p: { id: string }) => p.id === id).dub, { total: 2, recorded: 0 });

  // запись: проверки
  const put = (key: string, body?: Buffer, headers?: Record<string, string>) => dubRoute.PUT(raw(`/api/3d/${id}/dub/${key}`, "PUT", body, headers), keyCtx(id, key));
  assert.equal((await put("BAD")).status, 400);
  assert.equal((await put(k0)).status, 400, "пустое тело");
  assert.equal((await put(k0, Buffer.alloc(MAX_DUB_BYTES + 1))).status, 413);
  assert.equal((await put(k0, Buffer.from("<html>not audio at all</html>"))).status, 415);
  assert.equal((await put(k1, wav(1))).status, 409, "реплика Клода — не твоя");
  assert.equal((await dubRoute.PUT(raw(`/api/3d/nope-123/dub/${k0}`, "PUT", wav(1)), keyCtx("nope-123", k0))).status, 404);

  const saved = await put(k0, wav(1), { "Content-Type": "audio/webm" });
  assert.equal(saved.status, 200);
  const view = await saved.json();
  assert.equal(view.dub.takes[k0].take, 1);
  assert.equal(view.dub.version, 1);

  // отдача записи странице: FLAC, перемотка, кэш по ?v=
  const get = (key: string, query = "", headers: Record<string, string> = {}) => dubRoute.GET(raw(`/api/3d/${id}/dub/${key}${query}`, "GET", undefined, headers), keyCtx(id, key));
  const flac = await get(k0);
  assert.equal(flac.status, 200);
  assert.equal(flac.headers.get("content-type"), "audio/flac");
  assert.equal(flac.headers.get("cache-control"), "private, no-cache");
  const flacBody = Buffer.from(await flac.arrayBuffer());
  assert.equal(flacBody.subarray(0, 4).toString("latin1"), "fLaC");
  assert.equal(flacBody.length, view.dub.takes[k0].bytes);
  const head = await get(k0, `?v=${encodeURIComponent(view.dub.takes[k0].at)}`, { range: "bytes=0-3" });
  assert.equal(head.status, 206);
  assert.equal(head.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.equal(Buffer.from(await head.arrayBuffer()).toString("latin1"), "fLaC");
  assert.equal((await get(k2)).status, 404);

  // удаление и повторная запись
  const del = await dubRoute.DELETE(raw(`/api/3d/${id}/dub/${k0}`, "DELETE"), keyCtx(id, k0));
  assert.equal(del.status, 200);
  assert.equal((await del.json()).dub.takes[k0], undefined);
  assert.equal((await get(k0)).status, 404);
  assert.equal((await dubRoute.DELETE(raw(`/api/3d/${id}/dub/${k0}`, "DELETE"), keyCtx(id, k0))).status, 404);
  assert.equal((await put(k0, wav(0.9))).status, 200);
  assert.equal((await put(k2, wav(0.7))).status, 200);

  // подсказки: задача voice и реплики от раннера
  const voiceRun = await runRoute.POST(json(`/api/3d/${id}/run`, "POST", { task: "voice" }), ctx(id));
  assert.equal(voiceRun.status, 200);
  assert.equal((await voiceRun.json()).job.task, "voice");
  const voice = await (await claimRoute.POST()).json();
  assert.equal(voice.job.task, "voice");
  assert.deepEqual(voice.voice.keys, [k0, k1, k2]);
  assert.equal(voice.voice.ownVoice, false);
  const mp3 = Buffer.concat([Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000", "latin1"), Buffer.alloc(400, 1)]);
  const clipPut = (key: string, query: string, body: Buffer = mp3) => runnerClipRoute.PUT(raw(`/api/3d/runner/clip/${id}/${key}${query}`, "PUT", body), keyCtx(id, key));
  assert.equal((await clipPut(k0, "?duration=1.2")).status, 400, "без jobId");
  assert.equal((await clipPut(k0, "?jobId=other-job-1&duration=1.2")).status, 409);
  assert.equal((await clipPut(k0, `?jobId=${voice.job.id}&duration=1.2`, wav(0.2))).status, 415);
  assert.equal((await clipPut(k0, `?jobId=${voice.job.id}`)).status, 400, "без длительности");
  for (const key of [k0, k1, k2]) {
    const r = await clipPut(key, `?jobId=${voice.job.id}&duration=1.5`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).clip.key, key);
  }
  assert.equal((await completeRoute.POST(json("/api/3d/runner/complete", "POST", { id, jobId: voice.job.id }))).status, 200);
  const clip = await clipRoute.GET(raw(`/api/3d/${id}/clip/${k1}`, "GET"), keyCtx(id, k1));
  assert.equal(clip.status, 200);
  assert.equal(clip.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual(Buffer.from(await clip.arrayBuffer()), mp3);
  const nokey = lineKey("нет такой реплики");
  assert.equal((await clipRoute.GET(raw(`/api/3d/${id}/clip/${nokey}`, "GET"), keyCtx(id, nokey))).status, 404);

  // монтаж своим голосом: раннер берёт записи по плану
  const montageRun = await runRoute.POST(json(`/api/3d/${id}/run`, "POST", { task: "montage" }), ctx(id));
  assert.equal(montageRun.status, 200);
  assert.equal((await put(k0, wav(1))).status, 409, "пока идёт монтаж, записи не меняются");
  const montage = await (await claimRoute.POST()).json();
  assert.equal(montage.voice.ownVoice, true);
  assert.deepEqual(
    montage.voice.lines.map((l: { index: number; key: string; take: number }) => [l.index, l.key, l.take]),
    [
      [0, k0, 1],
      [2, k2, 1],
    ],
  );
  const takeGet = (key: string, query: string) => runnerDubRoute.GET(raw(`/api/3d/runner/dub/${id}/${key}${query}`, "GET"), keyCtx(id, key));
  const plan0 = montage.voice.lines[0];
  const got = await takeGet(k0, `?jobId=${montage.job.id}&take=${plan0.take}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "audio/flac");
  assert.equal(got.headers.get("x-sha256"), plan0.sha256);
  const body = Buffer.from(await got.arrayBuffer());
  assert.equal(body.length, plan0.bytes);
  const { createHash } = await import("crypto");
  assert.equal(createHash("sha256").update(body).digest("hex"), plan0.sha256);
  assert.equal((await takeGet(k0, `?jobId=${montage.job.id}&take=2`)).status, 409, "другой дубль");
  assert.equal((await takeGet(k0, `?jobId=other-job-1&take=${plan0.take}`)).status, 409);
  assert.equal((await takeGet(k0, `?jobId=${montage.job.id}`)).status, 400);

  const video = Buffer.from("fake-own-voice-mp4");
  const up = await uploadRoute.PUT(
    new NextRequest(url(`/api/3d/runner/video/${id}?jobId=${montage.job.id}`), {
      method: "PUT",
      body: new Uint8Array(video),
      headers: { "x-offset": "0", "x-file-size": String(video.length) },
    }),
    ctx(id),
  );
  assert.equal(up.status, 200);
  const done = await completeRoute.POST(
    json("/api/3d/runner/complete", "POST", { id, jobId: montage.job.id, video: { duration: 7, scriptVersion: 1, ownVoice: true, dubVersion: montage.voice.dubVersion } }),
  );
  assert.equal(done.status, 200);
  const project = await (await itemRoute.GET(new NextRequest(url(`/api/3d/${id}`)), ctx(id))).json();
  assert.equal(project.video.ownVoice, true);
  assert.equal(project.video.dubVersion, project.dub.version);
  // законченный монтаж больше не получает записи
  assert.equal((await takeGet(k0, `?jobId=${montage.job.id}&take=${plan0.take}`)).status, 409);

  assert.equal((await itemRoute.DELETE(new NextRequest(url(`/api/3d/${id}`)), ctx(id))).status, 200);
  assert.equal((await get(k0)).status, 404);
});

test("подсказки без реплик из тегов, старые записи убирает монтаж", async () => {
  const { lineKey } = await import("../lib/studio3d/rules");
  const script = {
    title: "Теги",
    lines: [
      { who: "me", text: "Клод, я купил монету на все деньги." },
      { who: "claude", text: "[laughs]" },
      { who: "me", text: "Что смешного?" },
      { who: "claude", text: "Ничего." },
      { who: "me", text: "[pause]" },
    ],
  };
  const keys = script.lines.map((l) => lineKey(l.text));
  const created = await listRoute.POST(json("/api/3d", "POST", { topic: "Теги в скетче" }));
  const { id } = await created.json();
  const first = await (await claimRoute.POST()).json();
  await scriptRoute.POST(json("/api/3d/runner/script", "POST", { id, jobId: first.job.id, script }));
  await completeRoute.POST(json("/api/3d/runner/complete", "POST", { id, jobId: first.job.id }));
  const list = await (await listRoute.GET()).json();
  assert.deepEqual(list.projects.find((p: { id: string }) => p.id === id).dub, { total: 2, recorded: 0 }, "[pause] записывать не нужно");

  // раннер озвучивает только реплики со словами
  assert.equal((await runRoute.POST(json(`/api/3d/${id}/run`, "POST", { task: "voice" }), ctx(id))).status, 200);
  const voice = await (await claimRoute.POST()).json();
  assert.deepEqual(voice.voice.keys, keys);
  const mp3 = Buffer.concat([Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000", "latin1"), Buffer.alloc(300, 2)]);
  for (const i of [0, 2, 3]) {
    const r = await runnerClipRoute.PUT(raw(`/api/3d/runner/clip/${id}/${keys[i]}?jobId=${voice.job.id}&duration=1`, "PUT", mp3), keyCtx(id, keys[i]));
    assert.equal(r.status, 200);
  }
  assert.equal((await completeRoute.POST(json("/api/3d/runner/complete", "POST", { id, jobId: voice.job.id }))).status, 200);
  let project = await (await itemRoute.GET(new NextRequest(url(`/api/3d/${id}`)), ctx(id))).json();
  assert.equal(project.job.state, "done", project.job.error);

  // записи владельца, потом реплику 3 переписали: её запись — старая
  const put = (key: string) => dubRoute.PUT(raw(`/api/3d/${id}/dub/${key}`, "PUT", wav(0.6)), keyCtx(id, key));
  assert.equal((await put(keys[0])).status, 200);
  assert.equal((await put(keys[2])).status, 200);
  const edited = { ...script, lines: script.lines.map((l, i) => (i === 2 ? { who: "me", text: "А что смешного?" } : l)) };
  assert.equal((await itemRoute.PATCH(json(`/api/3d/${id}`, "PATCH", { script: edited }), ctx(id))).status, 200);
  project = await (await itemRoute.GET(new NextRequest(url(`/api/3d/${id}`)), ctx(id))).json();
  const staleFile = path.join(root, id, project.dub.takes[keys[2]].file);
  assert.ok(fs.existsSync(staleFile));
  // старая запись по-прежнему слушается со страницы
  assert.equal((await dubRoute.GET(raw(`/api/3d/${id}/dub/${keys[2]}`, "GET"), keyCtx(id, keys[2]))).status, 200);

  // монтаж (без своего голоса) убирает её вместе с файлом
  assert.equal((await runRoute.POST(json(`/api/3d/${id}/run`, "POST", { task: "montage" }), ctx(id))).status, 200);
  project = await (await itemRoute.GET(new NextRequest(url(`/api/3d/${id}`)), ctx(id))).json();
  assert.deepEqual(Object.keys(project.dub.takes), [keys[0]]);
  assert.ok(!fs.existsSync(staleFile));
  assert.equal((await dubRoute.GET(raw(`/api/3d/${id}/dub/${keys[2]}`, "GET"), keyCtx(id, keys[2]))).status, 404);
  const montage = await (await claimRoute.POST()).json();
  await completeRoute.POST(json("/api/3d/runner/complete", "POST", { id, jobId: montage.job.id, error: "стоп" }));
  assert.equal((await itemRoute.DELETE(new NextRequest(url(`/api/3d/${id}`)), ctx(id))).status, 200);
});

test("озвучка поверх ролика: разметка с монтажом и с подсказками, дубли с отметками, сборка с моим голосом", async () => {
  const { lineKey } = await import("../lib/studio3d/rules");
  const { DUB_PRE_ROLL, LINES_VERSION } = await import("../lib/studio3d/types");
  const script = {
    title: "Поверх ролика",
    lines: [
      { who: "me", text: "Клод, я озвучу себя сам." },
      { who: "claude", text: "Давай, я подожду." },
      { who: "me", text: "Готово, слушай." },
    ],
  };
  const [k0, , k2] = script.lines.map((l) => lineKey(l.text));
  const windows = [
    { index: 0, who: "me", start: 0.4, end: 2.2 },
    { index: 1, who: "claude", start: 2.5, end: 4 },
    { index: 2, who: "me", start: 4.2, end: 5.5 },
  ];
  const getProject = async () => (await itemRoute.GET(new NextRequest(url(`/api/3d/${id}`)), ctx(id))).json();
  const upload = (jobId: string, body: Buffer) =>
    uploadRoute.PUT(
      new NextRequest(url(`/api/3d/runner/video/${id}?jobId=${jobId}`), { method: "PUT", body: new Uint8Array(body), headers: { "x-offset": "0", "x-file-size": String(body.length) } }),
      ctx(id),
    );
  const complete = (body: Record<string, unknown>) => completeRoute.POST(json("/api/3d/runner/complete", "POST", { id, ...body }));
  const run = (task: string) => runRoute.POST(json(`/api/3d/${id}/run`, "POST", { task }), ctx(id));

  const { id } = await (await listRoute.POST(json("/api/3d", "POST", { topic: "Озвучка поверх ролика" }))).json();
  const first = await (await claimRoute.POST()).json();
  await scriptRoute.POST(json("/api/3d/runner/script", "POST", { id, jobId: first.job.id, script }));
  await complete({ jobId: first.job.id });
  const noVideo = await run("dub");
  assert.equal(noVideo.status, 400);
  assert.match((await noVideo.json()).error, /сначала нужен ролик/);

  // ролик, смонтированный до хранения разметки; её приносят подсказки
  assert.equal((await run("montage")).status, 200);
  let job = (await (await claimRoute.POST()).json()).job;
  assert.equal((await upload(job.id, Buffer.from("old-mp4"))).status, 200);
  assert.equal((await complete({ jobId: job.id, video: { duration: 6, scriptVersion: 1 } })).status, 200);
  let project = await getProject();
  assert.equal(project.video.lines, undefined);
  assert.match((await (await run("dub")).json()).error, /нет разметки/);
  assert.equal((await run("voice")).status, 200);
  job = (await (await claimRoute.POST()).json()).job;
  assert.equal((await complete({ jobId: job.id, videoLines: { videoDuration: 6.04, lines: windows } })).status, 200);
  project = await getProject();
  assert.deepEqual(project.video.lines, windows);

  // дубли с отметками в адресе
  const put = (key: string, query: Record<string, string | number>, body = wav(3)) =>
    dubRoute.PUT(raw(`/api/3d/${id}/dub/${key}?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`, "PUT", body), keyCtx(id, key));
  const meta = (i: number, change: Record<string, string | number> = {}) => {
    const w = windows[i];
    return { videoStart: w.start - DUB_PRE_ROLL - 0.03, latencyMs: 30, lineStart: w.start, lineEnd: w.end, videoAt: project.video.at, ...change };
  };
  assert.equal((await put(k0, meta(0, { videoStart: "abc" }))).status, 400);
  const { videoAt: _, ...noAt } = meta(0);
  assert.equal((await put(k0, noAt)).status, 400, "без отметки ролика");
  const moved = await put(k0, meta(0, { videoAt: "2020-01-01T00:00:00.000Z" }));
  assert.equal(moved.status, 409);
  assert.equal((await moved.json()).error, "Ролик изменился — обновите страницу");
  assert.equal((await put(k0, meta(2))).status, 409, "окно чужой реплики");
  const saved = await put(k0, meta(0));
  assert.equal(saved.status, 200);
  const view = await saved.json();
  assert.equal(view.dub.takes[k0].videoAt, project.video.at);
  assert.equal(view.dub.takes[k0].lineStart, 0.4);
  assert.equal(view.dub.takes[k0].videoStart, -0.13);
  const half = await run("dub");
  assert.equal(half.status, 400);
  assert.match((await half.json()).error, /не озвучена реплика 3/);
  assert.equal((await put(k2, meta(2), wav(3.5))).status, 200);
  let list = (await (await listRoute.GET()).json()).projects.find((p: { id: string }) => p.id === id);
  assert.equal(list.dubbed, 2);

  // сборка: план с местами записей, тот же путь записей и видео, что у монтажа
  const queued = await run("dub");
  assert.equal(queued.status, 200);
  assert.equal((await queued.json()).job.task, "dub");
  assert.equal((await put(k0, meta(0))).status, 409, "пока идёт сборка, записи не меняются");
  const dub = await (await claimRoute.POST()).json();
  assert.equal(dub.job.task, "dub");
  assert.equal(dub.voice.ownVoice, true);
  assert.deepEqual(
    dub.voice.lines.map((l: { index: number; videoStart: number; lineStart: number; lineEnd: number }) => [l.index, l.videoStart, l.lineStart, l.lineEnd]),
    [
      [0, -0.13, 0.4, 2.2],
      [2, 3.67, 4.2, 5.5],
    ],
  );
  const take = await runnerDubRoute.GET(raw(`/api/3d/runner/dub/${id}/${k2}?jobId=${dub.job.id}&take=1`, "GET"), keyCtx(id, k2));
  assert.equal(take.status, 200);
  assert.equal(take.headers.get("x-sha256"), dub.voice.lines[1].sha256);
  assert.equal((await upload(dub.job.id, Buffer.from("dubbed-mp4"))).status, 200);
  const lines = windows.map((w) => ({ ...w, start: Math.round((w.start + 0.01) * 1000) / 1000 }));
  assert.equal((await complete({ jobId: dub.job.id, video: { duration: 6, scriptVersion: 1, ownVoice: true, dubVersion: dub.voice.dubVersion, lines } })).status, 200);
  project = await getProject();
  assert.equal(project.job.state, "done");
  assert.equal(project.video.ownVoice, true);
  assert.equal(project.video.dubVersion, project.dub.version);
  assert.deepEqual(project.video.lines, lines);
  assert.equal(project.dub.takes[k0].videoAt, project.video.at, "окна в допуске — записи переехали на новый ролик");
  assert.equal(project.dub.takes[k0].lineStart, 0.41, "и привязаны к его окнам");
  assert.equal(project.dub.takes[k0].videoStart, -0.13, "место на ролике то же");
  const video = await videoRoute.GET(new NextRequest(url(`/api/3d/${id}/video`)), ctx(id));
  assert.equal(Buffer.from(await video.arrayBuffer()).toString(), "dubbed-mp4");
  list = (await (await listRoute.GET()).json()).projects.find((p: { id: string }) => p.id === id);
  assert.equal(list.dubbed, 2);
  // окна сборки — по буквам: правка реплики и новая сборка ждут уточнения разметки
  const waiting = await put(k0, meta(0));
  assert.equal(waiting.status, 409);
  assert.match((await waiting.json()).error, /размечены по буквам — сначала уточните разметку/);
  assert.match((await (await run("dub")).json()).error, /реплики размечены по буквам/);

  // разметка по звуку (вздох перед словами, хвост последнего слова) заменяет прежнюю: записи по ней устаревают, но остаются
  const sound = lines.map((w) => ({ ...w, start: Math.max(0, Math.round((w.start - 0.3) * 1000) / 1000), end: Math.round((w.end + 0.12) * 1000) / 1000 }));
  assert.equal((await run("voice")).status, 200);
  job = (await (await claimRoute.POST()).json()).job;
  assert.equal((await complete({ jobId: job.id, videoLines: { videoDuration: 6, lines: sound, version: LINES_VERSION } })).status, 200);
  project = await getProject();
  assert.deepEqual(project.video.lines, sound);
  assert.equal(project.video.linesVersion, LINES_VERSION);
  assert.ok(project.dub.takes[k0] && project.dub.takes[k2], "записи не удалены");
  assert.equal((await dubRoute.GET(raw(`/api/3d/${id}/dub/${k0}`, "GET"), keyCtx(id, k0))).status, 200, "и слушаются");
  list = (await (await listRoute.GET()).json()).projects.find((p: { id: string }) => p.id === id);
  assert.equal(list.dubbed, 0);
  assert.match((await (await run("dub")).json()).error, /не озвучены реплики 1 и 3/);
  // та же версия ещё раз ничего не меняет
  assert.equal((await run("voice")).status, 200);
  job = (await (await claimRoute.POST()).json()).job;
  await complete({ jobId: job.id, videoLines: { videoDuration: 6, lines: windows, version: LINES_VERSION } });
  assert.deepEqual((await getProject()).video.lines, sound);

  assert.equal((await itemRoute.DELETE(new NextRequest(url(`/api/3d/${id}`)), ctx(id))).status, 200);
});
