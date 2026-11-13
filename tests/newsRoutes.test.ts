import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

/**
 * Маршруты исполнителя /api/news/runner/* и маршруты ролика без главного сайта (run, music, video, track) — без сети и
 * без ПК: временная папка вместо data/, «ПК» — эти же вызовы. Список и удаление идут через зеркало публикаций
 * и проверяются в tests/newsPublish.test.ts.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-news-routes-"));
process.env.NEWS_DATA_DIR = root;

let store: typeof import("../lib/news/store");
let runRoute: typeof import("../app/api/news/[id]/run/route");
let musicRoute: typeof import("../app/api/news/[id]/music/route");
let videoRoute: typeof import("../app/api/news/[id]/video/route");
let claimRoute: typeof import("../app/api/news/runner/claim/route");
let progressRoute: typeof import("../app/api/news/runner/progress/route");
let storyRoute: typeof import("../app/api/news/runner/story/route");
let uploadRoute: typeof import("../app/api/news/runner/video/[id]/route");
let completeRoute: typeof import("../app/api/news/runner/complete/route");
let trackUpload: typeof import("../app/api/news/runner/track/route");
let trackRoute: typeof import("../app/api/news/track/[sig]/route");

before(async () => {
  store = await import("../lib/news/store");
  runRoute = await import("../app/api/news/[id]/run/route");
  musicRoute = await import("../app/api/news/[id]/music/route");
  videoRoute = await import("../app/api/news/[id]/video/route");
  claimRoute = await import("../app/api/news/runner/claim/route");
  progressRoute = await import("../app/api/news/runner/progress/route");
  storyRoute = await import("../app/api/news/runner/story/route");
  uploadRoute = await import("../app/api/news/runner/video/[id]/route");
  completeRoute = await import("../app/api/news/runner/complete/route");
  trackUpload = await import("../app/api/news/runner/track/route");
  trackRoute = await import("../app/api/news/track/[sig]/route");
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

const url = (p: string) => `http://localhost${p}`;
const json = (p: string, method: string, body?: unknown) =>
  new NextRequest(url(p), body === undefined ? { method } : { method, body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (id: string, jobId: string, offset: number, total: number, data: Buffer) =>
  uploadRoute.PUT(
    new NextRequest(url(`/api/news/runner/video/${id}?jobId=${jobId}`), {
      method: "PUT",
      body: new Uint8Array(data),
      headers: { "x-offset": String(offset), "x-file-size": String(total), "Content-Type": "application/octet-stream" },
    }),
    ctx(id),
  );

const TRACKS = [
  { file: "VØJ, Narvent — Memory Reboot.m4a", title: "Memory Reboot", duration: 182.4 },
  { file: "calm.mp3", title: "Calm", duration: 95 },
];
const SIGNED = TRACKS.map((t, i) => ({ ...t, sig: ["0123456789abcdef", "fedcba9876543210"][i] }));

/** Настоящие ролик на 2 с и кусок трека: склейку проверяет настоящий ffmpeg. */
function media() {
  const video = path.join(root, "src-base.mp4");
  const track = path.join(root, "src-track.m4a");
  if (!fs.existsSync(video)) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=10:duration=2", "-f", "lavfi", "-i", "sine=frequency=300:duration=2", "-c:v", "mpeg4", "-c:a", "aac", "-shortest", video]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=1", "-c:a", "aac", track]);
  }
  return { video: fs.readFileSync(video), track: fs.readFileSync(track) };
}
const putTrack = (file: string, sig: string, data: Buffer) =>
  trackUpload.PUT(new NextRequest(url(`/api/news/runner/track?file=${encodeURIComponent(file)}&sig=${sig}`), { method: "PUT", body: new Uint8Array(data), headers: { "Content-Type": "audio/mp4" } }));
const story = {
  title: "Кореянка переименовала Vaseline",
  summary: "Блогерша из Сеула запустила свой бренд.",
  hero: "@mindaylee_ (TikTok)",
  sources: [{ url: "https://www.tiktok.com/@mindaylee_/video/1" }],
  script: "Эта девушка переименовала вазелин.",
};

test("полный путь ПК: взять с музыкой, прогресс, история, ролик кусками, конец; видео с перемоткой и скачиванием", async () => {
  // nothing to do yet; the claim body is optional, a broken one is a 400
  assert.deepEqual(await (await claimRoute.POST(json("/api/news/runner/claim", "POST"))).json(), { job: null });
  assert.equal((await claimRoute.POST(json("/api/news/runner/claim", "POST", "{не json"))).status, 400);
  assert.equal((await claimRoute.POST(json("/api/news/runner/claim", "POST", { tracks: "calm.mp3" }))).status, 400);
  assert.ok(store.runnerSeenAt(), "каждый вызов ПК отмечается");

  const p = await store.createProject();
  const claim = await (await claimRoute.POST(json("/api/news/runner/claim", "POST", { tracks: TRACKS }))).json();
  assert.equal(claim.project.id, p.id);
  assert.equal(claim.job.task, "create");
  assert.equal(claim.job.state, "running");
  assert.deepEqual(store.readTracks().tracks, TRACKS, "список музыки сохранён");
  const jobId: string = claim.job.id;

  assert.equal((await progressRoute.POST(json("/api/news/runner/progress", "POST", { id: "../x", jobId, step: "x", progress: 1 }))).status, 400);
  const prog = await progressRoute.POST(json("/api/news/runner/progress", "POST", { id: p.id, jobId, step: "Ищем историю", progress: 10 }));
  assert.deepEqual(await prog.json(), { ok: true, progress: 10 });
  assert.equal((await progressRoute.POST(json("/api/news/runner/progress", "POST", { id: p.id, jobId: "other-job-1", step: "x", progress: 1 }))).status, 409);

  assert.equal((await storyRoute.POST(json("/api/news/runner/story", "POST", { id: p.id, jobId, story: { ...story, title: "" } }))).status, 400);
  const st = await storyRoute.POST(json("/api/news/runner/story", "POST", { id: p.id, jobId, story }));
  assert.deepEqual(await st.json(), { ok: true, title: story.title });

  // upload: headers checked before the body is read
  assert.equal((await uploadRoute.PUT(new NextRequest(url(`/api/news/runner/video/${p.id}?jobId=${jobId}`), { method: "PUT", body: "x" }), ctx(p.id))).status, 400);
  assert.equal((await put(p.id, "bad id!", 0, 4, Buffer.from("abcd"))).status, 400);
  assert.equal((await put(p.id, jobId, 0, 3 * 1024 ** 3, Buffer.from("abcd"))).status, 413);
  const bytes = Buffer.from("0123456789");
  assert.deepEqual(await (await put(p.id, jobId, 0, 10, bytes.subarray(0, 4))).json(), { ok: true, received: 4 });
  const resync = await put(p.id, jobId, 8, 10, bytes.subarray(8));
  assert.equal(resync.status, 409);
  assert.equal((await resync.json()).received, 4);
  assert.deepEqual(await (await put(p.id, jobId, 4, 10, bytes.subarray(4))).json(), { done: true, size: 10 });

  const done = await completeRoute.POST(json("/api/news/runner/complete", "POST", { id: p.id, jobId, video: { duration: 30.5, music: TRACKS[0].file } }));
  const answer = await done.json();
  assert.equal(answer.job.state, "done");
  const project = store.getProject(p.id)!;
  assert.equal(project.video?.music, null, "трека нет на сайте — ролик без музыки");

  // the video: whole, a range, cached with ?v=, a download with the story's title
  const whole = await videoRoute.GET(new NextRequest(url(`/api/news/${p.id}/video`)), ctx(p.id));
  assert.equal(whole.status, 200);
  assert.equal(await whole.text(), "0123456789");
  assert.equal(whole.headers.get("cache-control"), "private, no-cache");
  const range = await videoRoute.GET(new NextRequest(url(`/api/news/${p.id}/video?v=${encodeURIComponent(project.video!.at)}`), { headers: { range: "bytes=2-5" } }), ctx(p.id));
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "2345");
  assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
  assert.match(range.headers.get("cache-control") ?? "", /immutable/);
  const dl = await videoRoute.GET(new NextRequest(url(`/api/news/${p.id}/video?download=1`)), ctx(p.id));
  assert.match(dl.headers.get("content-disposition") ?? "", /^attachment; filename="gudini-news-[a-z0-9-]+\.mp4"; filename\*=UTF-8''%D0%9A/);
  const base = await videoRoute.GET(new NextRequest(url(`/api/news/${p.id}/video?base=1&v=${encodeURIComponent(project.video!.base!.at)}`)), ctx(p.id));
  assert.equal(await base.text(), "0123456789", "основа без музыки для плеера «Монтажа»");
  assert.match(base.headers.get("cache-control") ?? "", /immutable/);
  assert.equal((await videoRoute.GET(new NextRequest(url("/api/news/x/video")), ctx("../x"))).status, 400);
  assert.equal((await videoRoute.GET(new NextRequest(url("/api/news/nope/video")), ctx("nope-123"))).status, 404);
});

test("музыка маршрутом: куски треков от ПК, трек склеивается сразу без задачи; перемонтаж — задача ПК", async () => {
  const p = await store.createProject();
  const nope = await musicRoute.POST(json(`/api/news/${p.id}/music`, "POST", { music: TRACKS[1].file }), ctx(p.id));
  assert.equal(nope.status, 409, "ролика ещё нет");
  // the runner reports signed tracks: the claim asks for both pieces
  const claim = await (await claimRoute.POST(json("/api/news/runner/claim", "POST", { tracks: SIGNED }))).json();
  assert.deepEqual(claim.needTracks, TRACKS.map((t) => t.file));
  await completeRoute.POST(json("/api/news/runner/complete", "POST", { id: p.id, jobId: claim.job.id, error: "не нашёл" }));
  const noVideo = await musicRoute.POST(json(`/api/news/${p.id}/music`, "POST", { music: TRACKS[1].file }), ctx(p.id));
  assert.equal(noVideo.status, 409);
  assert.match((await noVideo.json()).error, /готовый ролик/);
  assert.equal((await musicRoute.POST(json(`/api/news/${p.id}/music`, "POST", {}), ctx(p.id))).status, 400);
  assert.equal((await musicRoute.POST(json(`/api/news/${p.id}/music`, "POST", { music: "чужой.mp3" }), ctx(p.id))).status, 400);
  assert.equal((await musicRoute.POST(json(`/api/news/x/music`, "POST", { music: null }), ctx("../x"))).status, 400);

  // pieces of the tracks
  const { video, track } = media();
  assert.equal((await putTrack(TRACKS[0].file, "zz", track)).status, 400);
  assert.equal((await putTrack("чужой.mp3", SIGNED[0].sig, track)).status, 409);
  assert.equal((await putTrack(TRACKS[0].file, SIGNED[0].sig, track)).status, 200);
  assert.equal((await putTrack(TRACKS[1].file, SIGNED[1].sig, track)).status, 200);
  const again = await (await claimRoute.POST(json("/api/news/runner/claim", "POST", { tracks: SIGNED }))).json();
  assert.equal(again.needTracks, undefined, "всё на сайте — просить нечего");
  assert.equal(again.job, null);
  const piece = await trackRoute.GET(new NextRequest(url(`/api/news/track/${SIGNED[0].sig}`)), { params: Promise.resolve({ sig: SIGNED[0].sig }) });
  assert.equal(piece.status, 200);
  assert.equal(piece.headers.get("content-type"), "audio/mp4");
  assert.equal((await trackRoute.GET(new NextRequest(url("/api/news/track/x")), { params: Promise.resolve({ sig: "../x" }) })).status, 404);

  // «Создать заново»: тело не нужно; create или rerender
  assert.equal((await runRoute.POST(json(`/api/news/${p.id}/run`, "POST", { task: "music" }), ctx(p.id))).status, 400);
  const recreated = await runRoute.POST(json(`/api/news/${p.id}/run`, "POST"), ctx(p.id));
  assert.equal(recreated.status, 200);
  const view = await recreated.json();
  assert.equal(view.job.task, "create");
  assert.equal(view.job.lost, false);
  assert.equal((await runRoute.POST(json(`/api/news/${p.id}/run`, "POST", { task: "create" }), ctx(p.id))).status, 409, "одна задача за раз");

  // a video that starts with the runner's track
  const c2 = await (await claimRoute.POST(json("/api/news/runner/claim", "POST", { tracks: SIGNED }))).json();
  await storyRoute.POST(json("/api/news/runner/story", "POST", { id: p.id, jobId: c2.job.id, story }));
  await put(p.id, c2.job.id, 0, video.length, video);
  await completeRoute.POST(json("/api/news/runner/complete", "POST", { id: p.id, jobId: c2.job.id, video: { duration: 2, music: TRACKS[0].file } }));
  assert.equal(store.getProject(p.id)!.video?.music, TRACKS[0].file);

  // another track: mixed at once, no job for the PC, the page gets the list with ready marks
  const ok = await musicRoute.POST(json(`/api/news/${p.id}/music`, "POST", { music: TRACKS[1].file }), ctx(p.id));
  assert.equal(ok.status, 200);
  const changed = await ok.json();
  assert.equal(changed.video.music, TRACKS[1].file);
  assert.equal(changed.job.state, "done", "задача create так и осталась последней");
  assert.deepEqual(changed.tracks, SIGNED.map((t) => ({ ...t, ready: true })));
  const v = await videoRoute.GET(new NextRequest(url(`/api/news/${p.id}/video`)), ctx(p.id));
  assert.notDeepEqual(Buffer.from(await v.arrayBuffer()), video, "в публикуемом ролике — основа с треком");

  // rerender: a job for the PC; the owner's track stays
  const rr = await runRoute.POST(json(`/api/news/${p.id}/run`, "POST", { task: "rerender" }), ctx(p.id));
  assert.equal((await rr.json()).job.task, "rerender");
  const c3 = await (await claimRoute.POST(json("/api/news/runner/claim", "POST", { tracks: SIGNED }))).json();
  assert.equal(c3.job.task, "rerender");
  await put(p.id, c3.job.id, 0, video.length, video);
  const fin = await (await completeRoute.POST(json("/api/news/runner/complete", "POST", { id: p.id, jobId: c3.job.id, video: { duration: 2, music: null } }))).json();
  assert.equal(fin.job.state, "done");
  assert.equal(store.getProject(p.id)!.video?.music, TRACKS[1].file);
});

test("запас историй: ПК присылает его с claim, владелец выбирает, отклоняет и просит ещё", async () => {
  const stock = await import("../lib/news/stock");
  const listRoute = await import("../app/api/news/route");
  const stockRoute = await import("../app/api/news/stock/route");
  while (await store.claimNext()) {
    /* очередь прошлых проверок разобрана: дальше claim выдаёт только наш ролик */
  }
  const a = { id: "mvpicka0001", title: "MrBeast выбрал Узбекистан", summary: "Блогер поехал путешествовать.", why: "Его знают все", hero: "@mrbeast (YouTube)", anchor: "MrBeast", hook: "Пару недель назад MrBeast поехал путешествовать.", score: 9, verdict: "Знают все.", sources: ["https://example.com/a"], at: "2026-10-29T10:00:00.000Z", sequelOf: null };
  const b = { ...a, id: "mvpickb0002", title: "Майнкрафт показал небывалое", score: 8 };
  const claim = async (report: unknown) => (await claimRoute.POST(json("/api/news/runner/claim", "POST", { stock: report }))).json();

  // сломанная история отброшена, остальные — как прислал ПК
  await claim({ stories: [a, b, { id: "x", title: "" }], searching: null });
  assert.deepEqual(stock.stockView().stories.map((s) => s.id), [a.id, b.id]);

  // крипто-история приходит с меткой и очередью; чужая метка отбрасывается
  await claim({ stories: [{ ...a, lane: "crypto-fun", due: true }, { ...b, lane: "politics", due: true }], searching: null });
  assert.deepEqual(stock.stockView().stories.map((s) => [s.lane, s.due]), [["crypto-fun", true], [undefined, undefined]]);
  await claim({ stories: [a, b], searching: null });

  // «Не то»: из списка сразу, ПК получает отказ, пока его запас не покажет, что истории нет
  assert.equal((await stockRoute.POST(json("/api/news/stock", "POST", { reject: b.id }))).status, 200);
  assert.deepEqual(stock.stockView().stories.map((s) => s.id), [a.id]);
  assert.deepEqual((await claim({ stories: [a, b], searching: null })).stockOrders, { reject: [b.id], drop: [], more: false });
  assert.equal((await claim({ stories: [a], searching: null })).stockOrders, undefined);
  assert.equal((await stockRoute.POST(json("/api/news/stock", "POST", { reject: "mvnone0000" }))).status, 404);

  // «Убрать»: тоже из списка сразу, но отдельным списком — ПК не считает это вкусом
  const c = { ...a, id: "mvpickc0003", title: "Устаревшая история" };
  await claim({ stories: [a, c], searching: null });
  assert.equal((await stockRoute.POST(json("/api/news/stock", "POST", { drop: c.id }))).status, 200);
  assert.deepEqual(stock.stockView().stories.map((s) => s.id), [a.id]);
  assert.deepEqual((await claim({ stories: [a, c], searching: null })).stockOrders, { reject: [], drop: [c.id], more: false });
  assert.equal((await claim({ stories: [a], searching: null })).stockOrders, undefined);

  // «Найти ещё» держится, пока ПК не начал искать
  await stockRoute.POST(json("/api/news/stock", "POST", { more: true }));
  assert.equal(stock.stockView().morePending, true);
  assert.deepEqual((await claim({ stories: [a], searching: null })).stockOrders, { reject: [], drop: [], more: true });
  assert.equal((await claim({ stories: [a], searching: { startedAt: "2026-10-29T11:00:00.000Z" } })).stockOrders, undefined);
  assert.deepEqual(stock.stockView(), { stories: [a], searching: { startedAt: "2026-10-29T11:00:00.000Z" }, morePending: false, at: stock.stockView().at });

  // «Монтировать»: ролик по этой истории, в списке она больше не предлагается
  assert.equal((await listRoute.POST(json("/api/news", "POST", { pick: "mvnone0000" }))).status, 409);
  const made = await listRoute.POST(json("/api/news", "POST", { pick: a.id }));
  assert.equal(made.status, 201);
  const { id } = await made.json();
  assert.equal(store.getProject(id)!.story?.title, a.title);
  assert.deepEqual(stock.stockView().stories, []);
  const taken = await claim({ stories: [a], searching: null });
  assert.equal(taken.project.id, id);
  assert.equal(taken.job.pick, a.id);
  // без тела — как раньше: ПК возьмёт лучшую историю сам
  const plain = await listRoute.POST(json("/api/news", "POST"));
  assert.equal(store.getProject((await plain.json()).id)!.job?.pick, undefined);
});
