import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  basePath,
  BASE_FILE,
  cancelQueued,
  claimNext,
  completeJob,
  createProject,
  enqueueRerender,
  getProject,
  isLost,
  isProjectId,
  listProjects,
  missingTracks,
  mutate,
  newsRoot,
  projectDir,
  readTracks,
  receiveTrack,
  receiveVideoChunk,
  recreate,
  removeProject,
  reportProgress,
  saveTracks,
  setMusic,
  setStory,
  trackFile,
  UPLOAD_FILE,
  videoPath,
} from "../lib/news/store";
import { statusOf, toSummary, toView } from "../lib/news/rules";
import { STALE_MS, type NewsProject, type NewsStory } from "../lib/news/types";

/** Каждый тест — в своей временной папке: данные сайта не трогаются. */
const roots: string[] = [];
function freshRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-news-store-"));
  roots.push(dir);
  process.env.NEWS_DATA_DIR = dir;
  return dir;
}
after(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

const story: NewsStory = {
  title: "Кореянка переименовала Vaseline",
  summary: "Блогерша из Сеула решила, что Vaseline звучит скучно, и запустила свой бренд.",
  hero: "@mindaylee_ (TikTok)",
  sources: [{ url: "https://www.tiktok.com/@mindaylee_/video/1", note: "исходный ролик" }],
  script: "Эта девушка из Сеула переименовала вазелин.\nА потом случилось вот что.",
};

const TRACKS = [
  { file: "VØJ, Narvent — Memory Reboot.m4a", title: "Memory Reboot", duration: 182.4 },
  { file: "calm.mp3", title: "Calm", duration: 95 },
];

/** Настоящие ролик на 2 с и кусок трека: склейку музыки проверяет настоящий ffmpeg. */
let mediaCache: { video: Buffer; track: Buffer } | null = null;
function media() {
  if (mediaCache) return mediaCache;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-news-media-"));
  roots.push(dir);
  const video = path.join(dir, "base.mp4");
  const track = path.join(dir, "track.m4a");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=10:duration=2", "-f", "lavfi", "-i", "sine=frequency=300:duration=2", "-c:v", "mpeg4", "-c:a", "aac", "-shortest", video]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=1", "-c:a", "aac", track]);
  mediaCache = { video: fs.readFileSync(video), track: fs.readFileSync(track) };
  return mediaCache;
}
const streams = (file: string) => execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file], { encoding: "utf8" }).trim().split(/\s+/);
const seconds = (file: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }));
const SIGS = ["0123456789abcdef", "fedcba9876543210"];
const SIGNED = TRACKS.map((t, i) => ({ ...t, sig: SIGS[i] }));

/** Возраст задачи подделывается прямо в файле — так ПК «замолкает» без ожидания 10 минут. */
function ageHeartbeat(id: string, ms: number) {
  const file = path.join(projectDir(id), "project.json");
  const p = JSON.parse(fs.readFileSync(file, "utf8")) as NewsProject;
  p.job!.heartbeatAt = new Date(Date.now() - ms).toISOString();
  fs.writeFileSync(file, JSON.stringify(p));
}

const rejects = (p: Promise<unknown>, status: number, re?: RegExp) =>
  assert.rejects(p, (e: any) => {
    assert.equal(e.status, status, e.message);
    if (re) assert.match(e.message, re);
    return true;
  });

/** Весь путь задачи create от «ПК»: взять, история, ролик одним куском, конец. */
async function made(content: string | Buffer = "mp4!", music: string | null = TRACKS[0].file) {
  const p = await createProject();
  const claimed = await claimNext();
  assert.equal(claimed?.project.id, p.id);
  await setStory(p.id, claimed!.job.id, story);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  assert.deepEqual(await receiveVideoChunk(p.id, claimed!.job.id, 0, bytes.length, bytes), { done: true, size: bytes.length });
  await completeJob(p.id, claimed!.job.id, { video: { duration: 42.123, music } });
  return getProject(p.id)!;
}

test("создание → взятие → прогресс → история → ролик кусками → готово", async () => {
  const root = freshRoot();
  const p = await createProject();
  assert.ok(isProjectId(p.id));
  assert.ok(fs.existsSync(path.join(root, p.id, "project.json")));
  assert.equal(p.story, null);
  assert.equal(p.video, null);
  assert.equal(p.job?.task, "create");
  assert.equal(p.job?.state, "queued");
  assert.equal(statusOf(toSummary(p)).text, "В очереди");

  const claimed = await claimNext();
  assert.ok(claimed);
  assert.equal(claimed.project.id, p.id);
  assert.equal(claimed.job.state, "running");
  assert.equal(claimed.job.step, "Взял в работу");
  assert.ok(claimed.job.startedAt && claimed.job.heartbeatAt);
  assert.equal(await claimNext(), null, "вторую задачу не выдаём");
  assert.equal(statusOf(toSummary(getProject(p.id)!)).text, "Ищем историю");

  const job = await reportProgress(p.id, claimed.job.id, "  Ищем   историю  ", 150);
  assert.equal(job.step, "Ищем историю");
  assert.equal(job.progress, 99, "100% — только у законченной задачи");
  assert.equal((await reportProgress(p.id, claimed.job.id, "", -5)).progress, 0);
  assert.equal((await reportProgress(p.id, claimed.job.id, undefined, "nope")).step, "Ищем историю", "пустой шаг и мусор не затирают прежние");

  const withStory = await setStory(p.id, claimed.job.id, { ...story, title: `  ${story.title}  ` });
  assert.equal(withStory.story?.title, story.title);
  assert.deepEqual(withStory.story?.sources, [{ url: "https://www.tiktok.com/@mindaylee_/video/1", note: "исходный ролик" }]);
  assert.equal(withStory.story?.script, story.script, "переносы строк озвучки остаются");
  await reportProgress(p.id, claimed.job.id, "Монтируем", 60);
  assert.equal(statusOf(toSummary(getProject(p.id)!)).text, "Делаем ролик · 60%");

  // ролик кусками: повтор куска, рассинхрон, лишний кусок
  const bytes = Buffer.from("0123456789abcdef");
  const jid = claimed.job.id;
  assert.deepEqual(await receiveVideoChunk(p.id, jid, 0, 16, bytes.subarray(0, 6)), { received: 6 });
  assert.deepEqual(await receiveVideoChunk(p.id, jid, 0, 16, bytes.subarray(0, 6)), { received: 6 }, "повтор первого куска — с начала");
  assert.deepEqual(await receiveVideoChunk(p.id, jid, 6, 16, bytes.subarray(6, 12)), { received: 12 });
  assert.deepEqual(await receiveVideoChunk(p.id, jid, 6, 16, bytes.subarray(6, 12)), { received: 12 }, "повтор последнего куска принимается молча");
  assert.deepEqual(await receiveVideoChunk(p.id, jid, 2, 16, bytes.subarray(2, 4)), { resync: 12 });
  await rejects(receiveVideoChunk(p.id, jid, 12, 16, Buffer.alloc(8)), 400, /не помещается/);
  await rejects(receiveVideoChunk(p.id, jid, 0, 3 * 1024 ** 3, Buffer.from("x")), 413);
  assert.deepEqual(await receiveVideoChunk(p.id, jid, 12, 16, bytes.subarray(12)), { done: true, size: 16 });
  // ответ на последний кусок потерялся — его повтор узнаётся
  assert.deepEqual(await receiveVideoChunk(p.id, jid, 12, 16, bytes.subarray(12)), { done: true, size: 16 });
  assert.ok(fs.existsSync(path.join(projectDir(p.id), UPLOAD_FILE)));
  assert.equal(fs.existsSync(basePath(p.id)), false, "на место base.mp4 файл встаёт только с концом задачи");

  // трек, которого на сайте ещё нет, не держит ролик: он выходит без музыки
  const done = await completeJob(p.id, jid, { video: { duration: 41.987, music: TRACKS[0].file } });
  assert.equal(done.job?.state, "done");
  assert.equal(done.job?.progress, 100);
  assert.equal(done.video?.file, "out.mp4");
  assert.equal(done.video?.duration, 41.99);
  assert.equal(done.video?.music, null);
  assert.deepEqual(done.video?.base, { file: BASE_FILE, at: done.video?.at });
  assert.equal(fs.readFileSync(basePath(p.id), "utf8"), "0123456789abcdef");
  assert.equal(fs.readFileSync(videoPath(p.id), "utf8"), "0123456789abcdef", "без музыки ролик — сама основа");
  assert.equal(fs.existsSync(path.join(projectDir(p.id), UPLOAD_FILE)), false);

  const view = toView(getProject(p.id)!);
  assert.equal(view.job?.lost, false);
  assert.equal(view.story?.title, story.title);
  const summary = toSummary(getProject(p.id)!);
  assert.equal(summary.title, story.title);
  assert.equal(summary.hero, story.hero);
  assert.equal(statusOf(summary).text, "Готово");
  await rejects(reportProgress(p.id, jid, "ещё", 10), 409, /не актуальна/);
});

test("вызовы ПК с чужим jobId или для удалённого ролика — 409, ролик не меняется", async () => {
  freshRoot();
  const p = await createProject();
  const claimed = (await claimNext())!;
  await rejects(reportProgress(p.id, "other-job-1", "x", 1), 409, /не актуальна/);
  await rejects(setStory(p.id, "other-job-1", story), 409);
  await rejects(receiveVideoChunk(p.id, "other-job-1", 0, 4, Buffer.from("abcd")), 409);
  await rejects(completeJob(p.id, "other-job-1", {}), 409);
  assert.equal(getProject(p.id)!.story, null);
  // the owner may delete only a lost running job; a deleted project answers the runner like a replaced job
  ageHeartbeat(p.id, STALE_MS + 1000);
  await removeProject(p.id);
  await rejects(reportProgress(p.id, claimed.job.id, "x", 1), 409, /не актуальна/);
  await rejects(receiveVideoChunk(p.id, claimed.job.id, 0, 4, Buffer.from("abcd")), 409);
});

test("история от ПК проверяется целиком: неверная не сохраняется, повтор той же — не изменение", async () => {
  freshRoot();
  const p = await createProject();
  const { job } = (await claimNext())!;
  await rejects(setStory(p.id, job.id, { ...story, title: "" }), 400, /заголовка/);
  await rejects(setStory(p.id, job.id, { ...story, sources: [{ url: "javascript:alert(1)" }] }), 400, /http/);
  await rejects(setStory(p.id, job.id, { ...story, script: "   " }), 400, /озвучки/);
  await rejects(setStory(p.id, job.id, "история"), 400);
  assert.equal(getProject(p.id)!.story, null);
  const first = await setStory(p.id, job.id, story);
  const again = await setStory(p.id, job.id, story);
  assert.deepEqual(again.story, first.story);
});

test("конец задачи: ошибка, без истории, без загрузки, без длительности", async () => {
  freshRoot();
  const a = await createProject();
  const ja = (await claimNext())!.job;
  const failed = await completeJob(a.id, ja.id, { error: "  Не нашёл истории  " });
  assert.equal(failed.job?.state, "error");
  assert.equal(failed.job?.error, "Не нашёл истории");
  assert.equal(statusOf(toSummary(failed)).text, "Ошибка");

  const b = await createProject();
  const jb = (await claimNext())!.job;
  assert.equal((await completeJob(b.id, jb.id, { video: { duration: 10, music: null } })).job?.error, "Исполнитель не прислал историю");

  const c = await createProject();
  const jc = (await claimNext())!.job;
  await setStory(c.id, jc.id, story);
  assert.equal((await completeJob(c.id, jc.id, { video: { duration: 10, music: null } })).job?.error, "Видео не загрузилось на сайт");

  const d = await createProject();
  const jd = (await claimNext())!.job;
  await setStory(d.id, jd.id, story);
  await receiveVideoChunk(d.id, jd.id, 0, 4, Buffer.from("mp4!"));
  const bad = await completeJob(d.id, jd.id, { video: { duration: "долго", music: 7 } });
  assert.match(bad.job?.error ?? "", /длительность/);
  assert.equal(bad.video, null);
  assert.equal(fs.existsSync(path.join(projectDir(d.id), UPLOAD_FILE)), false, "загрузка неудавшейся задачи убирается");
});

test("«Создать заново»: после ошибки или пропажи ПК — на том же ролике; при готовом ролике и живой задаче — нельзя", async () => {
  freshRoot();
  const p = await createProject();
  await rejects(recreate(p.id), 409, /Идёт задача/);
  const first = (await claimNext())!.job;
  await setStory(p.id, first.id, story);
  await rejects(recreate(p.id), 409, /Идёт задача/);

  // ПК пропал: задача потеряна, её заменяют, поздние вызовы старой получают 409
  ageHeartbeat(p.id, STALE_MS + 1000);
  assert.equal(isLost(getProject(p.id)!.job), true);
  assert.equal(statusOf(toSummary(getProject(p.id)!)).text, "ПК не отвечает");
  const again = await recreate(p.id);
  assert.equal(again.job?.task, "create");
  assert.equal(again.job?.state, "queued");
  assert.notEqual(again.job?.id, first.id);
  assert.equal(again.story, null, "прежняя история не висит, пока ищется новая");
  await rejects(setStory(p.id, first.id, story), 409);

  const second = (await claimNext())!.job;
  await completeJob(p.id, second.id, { error: "сломалось" });
  const third = await recreate(p.id);
  assert.equal(third.job?.state, "queued");
  await cancelQueued(p.id);

  const ready = await made();
  await rejects(recreate(ready.id), 409, /уже готов/);
});

test("музыка: список с ПК, куски треков от ПК, трек под готовым роликом склеивается на сайте сразу", async () => {
  freshRoot();
  const empty = readTracks();
  assert.deepEqual(empty, { tracks: [], at: null });
  const saved = await saveTracks([...TRACKS, { file: "../evil.mp3", title: "x", duration: 10 }, { file: "calm.mp3", title: "дубль", duration: 5 }, { file: "zero.mp3", duration: 0 }]);
  assert.deepEqual(saved.tracks, TRACKS, "плохие записи и повторы отброшены, хорошие остались");
  assert.ok(saved.at);
  const same = await saveTracks(TRACKS);
  assert.equal(same.at, saved.at, "тот же список не переписывается");
  await rejects(saveTracks("calm.mp3"), 400);
  assert.deepEqual((await saveTracks([{ ...SIGNED[0], sig: "../x" }])).tracks, [TRACKS[0]], "кривой sig отброшен, трек остался");

  // куски треков: только для трека из списка с тем же sig
  await saveTracks(SIGNED);
  assert.deepEqual(missingTracks(), TRACKS.map((t) => t.file), "ПК попросят прислать оба");
  const { video, track } = media();
  await rejects(receiveTrack(TRACKS[0].file, "../../x", track), 400, /sig/);
  await rejects(receiveTrack(TRACKS[0].file, SIGS[1], track), 409, /нет в списке/);
  await rejects(receiveTrack(TRACKS[0].file, SIGS[0], Buffer.alloc(0)), 400);
  await receiveTrack(TRACKS[0].file, SIGS[0], track);
  assert.ok(trackFile(SIGS[0]));
  assert.deepEqual(missingTracks(), [TRACKS[1].file]);

  const p = await createProject();
  await rejects(setMusic(p.id, TRACKS[1].file), 409, /готовый ролик/);
  await rejects(setMusic(p.id, undefined), 400);
  await rejects(setMusic(p.id, "нет-такого.mp3"), 400, /news\/music/);
  await rejects(setMusic(p.id, 42), 400);
  await cancelQueued(p.id);

  // новый ролик начинает с трека, который предложил ПК, — сайт склеивает его сам
  const v = await made(video, TRACKS[0].file);
  assert.equal(v.video?.music, TRACKS[0].file);
  assert.deepEqual(fs.readFileSync(basePath(v.id)), video, "основа — ровно то, что прислал ПК");
  assert.notDeepEqual(fs.readFileSync(videoPath(v.id)), video, "в out.mp4 — основа с треком");
  assert.deepEqual(streams(videoPath(v.id)), ["video", "audio"]);
  assert.ok(Math.abs(seconds(videoPath(v.id)) - seconds(basePath(v.id))) < 0.15, "длина та же: трек идёт по кругу и кончается с роликом");

  // the caption and the cover made for this video
  await mutate(v.id, (q) => {
    q.meta = { title: "Вазелин", description: "", hashtags: ["#новости"] };
    q.cover = { file: "cover.jpg", at: v.video!.at, status: "ok", headline: "ВАЗЕЛИН", videoAt: v.video!.at };
  });
  const sameChoice = await setMusic(v.id, TRACKS[0].file);
  assert.equal(sameChoice.video?.at, v.video?.at, "тот же трек — ничего не меняется");
  await rejects(setMusic(v.id, TRACKS[1].file), 409, /не дошёл/);

  await new Promise((r) => setTimeout(r, 5));
  const off = await setMusic(v.id, null);
  assert.equal(off.video?.music, null);
  assert.notEqual(off.video?.at, v.video?.at, "новое время ролика: страница и зеркало берут новый файл");
  assert.equal(off.video?.base?.at, v.video?.base?.at, "основа та же: плеер «Монтажа» не перезагружается");
  assert.deepEqual(fs.readFileSync(videoPath(v.id)), video, "без музыки — сама основа");
  assert.deepEqual(off.meta, { title: "Вазелин", description: "", hashtags: ["#новости"] }, "подпись остаётся");
  assert.equal(off.cover?.headline, "ВАЗЕЛИН", "обложка остаётся");
  assert.equal(off.cover?.videoAt, off.video?.at, "кадры те же: обложка считается сделанной по новому ролику");
  assert.equal(getProject(v.id)!.job?.state, "done", "задачи для ПК нет");

  // перемонтаж на ПК оставляет выбранный трек
  await setMusic(v.id, TRACKS[0].file);
  const queued = await enqueueRerender(v.id);
  assert.equal(queued.job?.task, "rerender");
  assert.equal(statusOf(toSummary(queued)).text, "Перемонтаж в очереди");
  await rejects(enqueueRerender(v.id), 409, /Идёт задача/);
  const claimed = (await claimNext())!;
  assert.equal(claimed.job.task, "rerender");
  await rejects(setStory(v.id, claimed.job.id, story), 409, undefined);
  assert.equal(statusOf(toSummary(getProject(v.id)!)).text, "Перемонтируем · 0%");
  // трек меняется и во время перемонтажа — по прежней основе
  assert.equal((await setMusic(v.id, null)).video?.music, null);
  await setMusic(v.id, TRACKS[0].file);
  await receiveVideoChunk(v.id, claimed.job.id, 0, video.length, video);
  const done = await completeJob(v.id, claimed.job.id, { video: { duration: 2, music: null } });
  assert.equal(done.job?.state, "done");
  assert.equal(done.video?.music, TRACKS[0].file, "выбор владельца остаётся");
  assert.equal(done.video?.base?.at, done.video?.at, "новая основа");
  assert.equal(done.cover?.videoAt, done.video?.at);
});

test("неудачный перемонтаж не трогает ролик: загруженное до ошибки не встаёт на место", async () => {
  freshRoot();
  await saveTracks(TRACKS);
  const v = await made("old-video", null);
  const at = v.video!.at;
  await enqueueRerender(v.id);
  const { job } = (await claimNext())!;
  await receiveVideoChunk(v.id, job.id, 0, 9, Buffer.from("new-video"));
  const failed = await completeJob(v.id, job.id, { error: "ffmpeg упал" });
  assert.equal(failed.job?.state, "error");
  assert.equal(failed.video?.at, at);
  assert.equal(fs.readFileSync(videoPath(v.id), "utf8"), "old-video");
  assert.equal(fs.readFileSync(basePath(v.id), "utf8"), "old-video");
  assert.equal(statusOf(toSummary(failed)).text, "Готово", "ролик как был — готов");
  assert.equal((await enqueueRerender(v.id)).job?.state, "queued", "можно попросить снова");
});

test("ролик, смонтированный до мгновенной смены музыки: трек не меняется, пока его не перемонтируют", async () => {
  freshRoot();
  await saveTracks(SIGNED);
  await receiveTrack(TRACKS[0].file, SIGS[0], media().track);
  const v = await made("old-video", null);
  await mutate(v.id, (q) => {
    q.video = { file: "out.mp4", at: q.video!.at, duration: 42, music: null };
  });
  await rejects(setMusic(v.id, TRACKS[0].file), 409, /перемонтировать/);
  // старая задача «music» читается как перемонтаж
  await mutate(v.id, (q) => {
    q.job = { id: "old-music-1", task: "music", music: "calm.mp3", state: "done", step: "Готово", progress: 100, createdAt: new Date().toISOString() } as any;
  });
  const job = getProject(v.id)!.job as any;
  assert.equal(job.task, "rerender");
  assert.equal("music" in job, false);
});

test("перемонтаж в очереди без ролика (project.json правили руками) — задача с ошибкой, ПК её не получает", async () => {
  freshRoot();
  const p = await createProject();
  await mutate(p.id, (q) => {
    q.job = { id: "hand-made-1", task: "rerender", state: "queued", step: "В очереди", progress: 0, createdAt: new Date().toISOString() };
  });
  assert.equal(await claimNext(), null);
  assert.match(getProject(p.id)!.job?.error ?? "", /перемонтировать нечего/);
});

test("очередь: сначала самая старая задача; отмена задачи в очереди; удаление", async () => {
  freshRoot();
  const a = await createProject();
  await new Promise((r) => setTimeout(r, 5));
  const b = await createProject();
  assert.deepEqual(
    listProjects().map((p) => p.id),
    [b.id, a.id],
    "в списке свежие сверху",
  );
  assert.equal((await cancelQueued(b.id)).job, null);
  await rejects(cancelQueued(b.id), 409, /только задачу в очереди/);
  const first = (await claimNext())!;
  assert.equal(first.project.id, a.id);
  await rejects(cancelQueued(a.id), 409);
  await rejects(removeProject(a.id), 409, /Идёт задача/);
  await removeProject(b.id);
  assert.equal(getProject(b.id), null);
  await rejects(removeProject(b.id), 404);
});

test("одновременные изменения не теряются и не ломают файл", async () => {
  freshRoot();
  const p = await createProject();
  const { job } = (await claimNext())!;
  await Promise.all(Array.from({ length: 20 }, (_, i) => reportProgress(p.id, job.id, `шаг ${i}`, i)));
  const q = getProject(p.id)!;
  assert.equal(q.job?.step, "шаг 19");
  assert.equal(q.job?.progress, 19);
});

test("id из адреса не выводят за папку раздела; music.json — не ролик", async () => {
  const root = freshRoot();
  assert.equal(newsRoot(), path.resolve(root));
  for (const bad of ["../x", "..", "a/b", "abc", "ABCDEFGH", "x".repeat(41), ""]) {
    assert.equal(isProjectId(bad), false, bad);
    assert.throws(() => projectDir(bad), (e: any) => e.status === 400);
    assert.equal(getProject(bad), null);
  }
  await saveTracks(TRACKS);
  await createProject();
  assert.equal(listProjects().length, 1);
});

test("старый project.json получает недостающие поля", async () => {
  freshRoot();
  const p = await createProject();
  const file = path.join(projectDir(p.id), "project.json");
  fs.writeFileSync(file, JSON.stringify({ id: p.id, createdAt: p.createdAt, video: { file: "out.mp4", at: p.createdAt, duration: 3 } }));
  const q = getProject(p.id)!;
  assert.equal(q.story, null);
  assert.equal(q.job, null);
  assert.equal(q.video?.music, null);
  assert.equal(q.video?.base, null, "основы без музыки у старого ролика нет");
  assert.equal(q.meta, null);
  assert.equal(q.cover, null);
  assert.equal(q.mirrorId, null);
  assert.equal(q.updatedAt, p.createdAt);
  fs.writeFileSync(file, "{не json");
  assert.equal(getProject(p.id), null);
});
