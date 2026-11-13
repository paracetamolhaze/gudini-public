import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import {
  cancelQueued,
  checkWindows,
  claimNext,
  completeJob,
  createProject,
  dubTakeFile,
  enqueue,
  getProject,
  isLost,
  isProjectId,
  lineClipFile,
  listProjects,
  patchProject,
  projectDir,
  receiveVideoChunk,
  removeDubTake,
  removeProject,
  reportProgress,
  runnerDubTake,
  saveDubTake,
  saveLineClip,
  setScriptFromRunner,
  studio3dRoot,
  videoPath,
} from "../lib/studio3d/store";
import {
  checkScript,
  clipFor,
  dubLines,
  dubProgress,
  dubSpan,
  hasWords,
  isLineKey,
  letterWindows,
  lineKey,
  linesVersionOf,
  median,
  missingClips,
  montageWarning,
  needsRefine,
  overVideoLines,
  ownLines,
  placeTake,
  refineTried,
  remeasuring,
  retimed,
  staleTakes,
  statusOf,
  takeFits,
  takeSlip,
  toSummary,
  videoWindows,
  voiceOverLines,
  voiceOverProgress,
} from "../lib/studio3d/rules";
import { probe, sniffAudio } from "../lib/studio3d/audio";
import {
  DUB_PRE_ROLL,
  LINES_VERSION,
  MAX_CLIP_BYTES,
  MAX_DUB_BYTES,
  MAX_LINE_CHARS,
  MAX_LINES,
  MAX_SCRIPT_CHARS,
  STALE_MS,
  type DubTake,
  type Project3D,
  type Script3D,
  type VideoLine,
} from "../lib/studio3d/types";

/** Каждый тест — в своей временной папке: данные сайта не трогаются. */
const roots: string[] = [];
function freshRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-3d-store-"));
  roots.push(dir);
  process.env.STUDIO3D_DATA_DIR = dir;
  return dir;
}
after(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

const dialog: Script3D = {
  title: "Биткоин на все деньги",
  lines: [
    { who: "me", text: "Клод, я решил вложить в биткоин всё!" },
    { who: "claude", text: "[sighs] Всё — это сколько?" },
    { who: "me", text: "Все сорок тысяч рублей." },
  ],
};

/** Возраст задачи подделывается прямо в файле — так контейнер «замолкает» без ожидания 10 минут. */
function ageHeartbeat(id: string, ms: number) {
  const file = path.join(projectDir(id), "project.json");
  const p = JSON.parse(fs.readFileSync(file, "utf8")) as Project3D;
  p.job!.heartbeatAt = new Date(Date.now() - ms).toISOString();
  fs.writeFileSync(file, JSON.stringify(p));
}

const rejects = (p: Promise<unknown>, status: number, re?: RegExp) =>
  assert.rejects(p, (e: any) => {
    assert.equal(e.status, status, e.message);
    if (re) assert.match(e.message, re);
    return true;
  });

/** Сценарий от «контейнера»: взять задачу, написать диалог, закончить. */
async function writeScript(id: string) {
  const claimed = await claimNext();
  assert.equal(claimed?.project.id, id);
  await setScriptFromRunner(id, claimed!.job.id, dialog);
  await completeJob(id, claimed!.job.id, {});
}

test("создание → взятие → прогресс → сценарий → готово", async () => {
  const root = freshRoot();
  const p = await createProject("  Как я покупал крипту  ", "  смешно  ");
  assert.ok(isProjectId(p.id));
  assert.ok(fs.existsSync(path.join(root, p.id, "project.json")));
  assert.equal(p.topic, "Как я покупал крипту");
  assert.equal(p.notes, "смешно");
  assert.equal(p.job?.task, "script");
  assert.equal(p.job?.state, "queued");
  assert.equal(statusOf(toSummary(p)).text, "В очереди");

  const claimed = await claimNext();
  assert.ok(claimed && "project" in claimed);
  assert.equal(claimed.job.state, "running");
  assert.equal(claimed.job.step, "Взял в работу");
  assert.ok(claimed.job.startedAt && claimed.job.heartbeatAt);
  assert.equal(await claimNext(), null, "вторую задачу не выдаём");
  assert.equal(statusOf(toSummary(getProject(p.id)!)).text, "Пишет сценарий");

  const job = await reportProgress(p.id, claimed.job.id, "  Клод   пишет  ", 140);
  assert.equal(job.step, "Клод пишет");
  assert.equal(job.progress, 99, "100 — только у законченной задачи");

  const withScript = await setScriptFromRunner(p.id, claimed.job.id, dialog);
  assert.equal(withScript.scriptVersion, 1);
  assert.deepEqual(withScript.script, dialog);

  const done = await completeJob(p.id, claimed.job.id, {});
  assert.equal(done.job?.state, "done");
  assert.equal(done.job?.progress, 100);
  assert.ok(done.job?.finishedAt);
  assert.equal(statusOf(toSummary(done)).text, "Сценарий готов");
  assert.equal(listProjects().length, 1);
});

test("вызовы контейнера с чужим jobId — 409, проект не меняется", async () => {
  freshRoot();
  const p = await createProject("Тема для конфликта");
  const claimed = (await claimNext())!;
  await rejects(reportProgress(p.id, "wrong-job-id", "шаг", 10), 409);
  await rejects(setScriptFromRunner(p.id, "wrong-job-id", dialog), 409);
  await rejects(completeJob(p.id, "wrong-job-id", {}), 409);
  await rejects(receiveVideoChunk(p.id, claimed.job.id, 0, 4, Buffer.from("abcd")), 409, /не актуальна/);
  const after = getProject(p.id)!;
  assert.equal(after.script, null);
  assert.equal(after.job?.state, "running");
  // законченная задача тоже больше не принимает вызовы
  await setScriptFromRunner(p.id, claimed.job.id, dialog);
  await completeJob(p.id, claimed.job.id, {});
  await rejects(reportProgress(p.id, claimed.job.id, "шаг", 10), 409);
});

test("ошибка задачи и сценарий без реплик от контейнера", async () => {
  freshRoot();
  const p = await createProject("Тема с ошибкой");
  let claimed = (await claimNext())!;
  const failed = await completeJob(p.id, claimed.job.id, { error: "Мост Claude не отвечает" });
  assert.equal(failed.job?.state, "error");
  assert.equal(failed.job?.error, "Мост Claude не отвечает");
  assert.equal(statusOf(toSummary(failed)).text, "Ошибка");

  await enqueue(p.id, "script");
  claimed = (await claimNext())!;
  const empty = await completeJob(p.id, claimed.job.id, {});
  assert.equal(empty.job?.state, "error", "без сценария задача не «готова»");
  assert.match(empty.job?.error ?? "", /сценари/);
});

test("повтор того же сценария от контейнера — не новая версия", async () => {
  freshRoot();
  const p = await createProject("Переписывание");
  await writeScript(p.id);
  assert.equal(getProject(p.id)!.scriptVersion, 1);

  // ответ на сценарий потерялся, контейнер прислал его ещё раз
  await enqueue(p.id, "script");
  const claimed = (await claimNext())!;
  const next: Script3D = { title: "Новая версия", lines: [...dialog.lines].reverse() };
  assert.equal((await setScriptFromRunner(p.id, claimed.job.id, next)).scriptVersion, 2);
  assert.equal((await setScriptFromRunner(p.id, claimed.job.id, next)).scriptVersion, 2);
  const done = await completeJob(p.id, claimed.job.id, {});
  assert.equal(done.job?.state, "done");
  assert.deepEqual(done.script, next);
});

test("сценарий от контейнера проверяется целиком и не обрезается", async () => {
  freshRoot();
  const p = await createProject("Проверка сценария");
  const { job } = (await claimNext())!;
  const bad: unknown[] = [
    { title: "x", lines: [{ who: "me", text: "одна реплика" }] },
    { title: "x", lines: [...dialog.lines, { who: "vitalik", text: "кто я" }] },
    { title: "x", lines: [...dialog.lines, { who: "me", text: "а".repeat(MAX_LINE_CHARS + 1) }] },
    { title: "x", lines: [...dialog.lines, { who: "claude", text: "[вздыхает] ну да" }] },
    { title: "x", lines: [...dialog.lines, { who: "me", text: "   " }] },
    { title: "x".repeat(121), lines: dialog.lines },
    "просто текст",
    null,
  ];
  for (const script of bad) await rejects(setScriptFromRunner(p.id, job.id, script), 400);
  assert.equal(getProject(p.id)!.script, null);
  assert.equal(getProject(p.id)!.scriptVersion, 0);
});

test("правки: ограничения, версия сценария, запрет во время задачи", async () => {
  freshRoot();
  const p = await createProject("Правки сценария");
  await rejects(patchProject(p.id, { topic: "Новая тема" }), 409, /Идёт задача/);
  await writeScript(p.id);

  const line = (text: string, who: "me" | "claude" = "me") => ({ who, text });
  const tooMany = { title: "", lines: Array.from({ length: MAX_LINES + 1 }, (_, i) => line(`реплика ${i}`)) };
  const tooLong = { title: "", lines: [line("а".repeat(MAX_LINE_CHARS + 1))] };
  const count = Math.ceil(MAX_SCRIPT_CHARS / MAX_LINE_CHARS) + 1;
  const perLine = Math.floor(MAX_SCRIPT_CHARS / count) + 1;
  const tooMuch = { title: "", lines: Array.from({ length: count }, () => line("б".repeat(perLine))) };
  assert.ok(perLine <= MAX_LINE_CHARS && count <= MAX_LINES, "лимит общей длины проверяется отдельно от остальных");
  await rejects(patchProject(p.id, { script: tooMany }), 400, /Реплик больше/);
  await rejects(patchProject(p.id, { script: tooLong }), 400, /длиннее/);
  await rejects(patchProject(p.id, { script: tooMuch }), 400, /Сценарий длиннее/);
  await rejects(patchProject(p.id, { script: { title: "т".repeat(121), lines: dialog.lines } }), 400, /Название/);
  await rejects(patchProject(p.id, { script: { title: "", lines: [{ who: "bob", text: "привет" }] } }), 400);
  await rejects(patchProject(p.id, { script: { title: "", lines: [] } }), 400);
  await rejects(patchProject(p.id, { topic: "ab" }), 400, /от 3 до 600/);
  await rejects(patchProject(p.id, { topic: "а".repeat(601) }), 400);
  await rejects(patchProject(p.id, { notes: "а".repeat(1001) }), 400);
  await rejects(patchProject(p.id, {}), 400);
  assert.equal(getProject(p.id)!.scriptVersion, 1);

  // тот же сценарий с лишними пробелами — не новая версия
  const same = await patchProject(p.id, { script: { title: ` ${dialog.title} `, lines: dialog.lines.map((l) => ({ ...l, text: `${l.text}\n` })) } });
  assert.equal(same.scriptVersion, 1);
  const edited = await patchProject(p.id, { script: { title: "Новое", lines: [line("Раз"), line("Два", "claude")] }, notes: "" });
  assert.equal(edited.scriptVersion, 2);
  assert.equal(edited.script?.title, "Новое");
  assert.equal(edited.notes, undefined);
  const exact = await patchProject(p.id, { script: { title: "", lines: [line("а".repeat(MAX_LINE_CHARS))] } });
  assert.equal(exact.script?.lines[0].text.length, MAX_LINE_CHARS, "ровно на лимите — можно");
});

test("монтаж: нужно две реплики, загрузка кусками, видео в проекте", async () => {
  freshRoot();
  const p = await createProject("Монтаж скетча");
  await writeScript(p.id);
  await patchProject(p.id, { script: { title: "", lines: [{ who: "me", text: "Одна" }] } });
  await rejects(enqueue(p.id, "montage"), 400, /двух реплик/);
  await rejects(enqueue(p.id, "render"), 400);
  await patchProject(p.id, { script: dialog });
  const queued = await enqueue(p.id, "montage");
  assert.equal(queued.job?.task, "montage");
  // пока задача жива, новую не ставим
  await rejects(enqueue(p.id, "script"), 409);

  const { job } = (await claimNext())!;
  const bytes = Buffer.from("0123456789abcdef");
  assert.deepEqual(await receiveVideoChunk(p.id, job.id, 0, 16, bytes.subarray(0, 6)), { received: 6 });
  // повтор того же куска (ответ потерялся) — без записи
  assert.deepEqual(await receiveVideoChunk(p.id, job.id, 0, 16, bytes.subarray(0, 6)), { received: 6 });
  // ответ на второй кусок потерялся, контейнер шлёт его снова
  assert.deepEqual(await receiveVideoChunk(p.id, job.id, 6, 16, bytes.subarray(6, 12)), { received: 12 });
  assert.deepEqual(await receiveVideoChunk(p.id, job.id, 6, 16, bytes.subarray(6, 12)), { received: 12 });
  // кусок не с того места — сайт говорит, сколько у него есть
  assert.deepEqual(await receiveVideoChunk(p.id, job.id, 2, 16, bytes.subarray(2, 4)), { resync: 12 });
  await rejects(receiveVideoChunk(p.id, job.id, 12, 16, Buffer.alloc(8)), 400, /не помещается/);
  await rejects(receiveVideoChunk(p.id, job.id, 0, 3 * 1024 ** 3, Buffer.from("x")), 413);
  assert.deepEqual(await receiveVideoChunk(p.id, job.id, 12, 16, bytes.subarray(12)), { done: true, size: 16 });
  assert.equal(fs.readFileSync(videoPath(p.id), "utf8"), "0123456789abcdef");
  assert.ok(!fs.existsSync(`${videoPath(p.id)}.part`));
  // последний кусок повторён после переименования — не заставляем грузить заново
  assert.deepEqual(await receiveVideoChunk(p.id, job.id, 12, 16, bytes.subarray(12)), { done: true, size: 16 });

  await reportProgress(p.id, job.id, "Рендер", 90);
  const done = await completeJob(p.id, job.id, { video: { duration: 31.234, scriptVersion: queued.scriptVersion } });
  assert.equal(done.job?.state, "done");
  assert.equal(done.video?.file, "out.mp4");
  assert.equal(done.video?.duration, 31.23);
  assert.equal(done.video?.scriptVersion, done.scriptVersion);
  assert.equal(statusOf(toSummary(done)).text, "Готово");
});

test("монтаж без свежего out.mp4 — ошибка, старое видео остаётся", async () => {
  freshRoot();
  const p = await createProject("Монтаж без файла");
  await writeScript(p.id);
  await enqueue(p.id, "montage");
  let { job } = (await claimNext())!;
  const noFile = await completeJob(p.id, job.id, { video: { duration: 10, scriptVersion: 1 } });
  assert.equal(noFile.job?.state, "error");
  assert.equal(noFile.video, null);

  // файл от прошлого монтажа: старше начала задачи
  fs.writeFileSync(videoPath(p.id), "old video");
  const hourAgo = new Date(Date.now() - 3600_000);
  fs.utimesSync(videoPath(p.id), hourAgo, hourAgo);
  await enqueue(p.id, "montage");
  ({ job } = (await claimNext())!);
  const stale = await completeJob(p.id, job.id, { video: { duration: 10, scriptVersion: 1 } });
  assert.equal(stale.job?.state, "error");
  assert.match(stale.job?.error ?? "", /не загрузилось/);

  await enqueue(p.id, "montage");
  ({ job } = (await claimNext())!);
  const noMeta = await completeJob(p.id, job.id, {});
  assert.equal(noMeta.job?.state, "error", "без длительности и версии видео не принимается");
});

test("потерянная задача: правки и замена, поздний контейнер получает 409", async () => {
  freshRoot();
  const p = await createProject("Контейнер пропал");
  const old = (await claimNext())!.job;
  await rejects(patchProject(p.id, { topic: "Пока живая — нельзя" }), 409);
  await rejects(removeProject(p.id), 409);

  ageHeartbeat(p.id, STALE_MS + 1000);
  const lost = getProject(p.id)!;
  assert.ok(isLost(lost.job));
  assert.equal(statusOf(toSummary(lost)).text, "Контейнер не отвечает");
  assert.equal(toSummary(lost).job?.lost, true);
  // правка владельца снимает потерянную задачу: вернувшийся контейнер не перезапишет её своим сценарием
  const edited = await patchProject(p.id, { topic: "Правка после пропажи" });
  assert.equal(edited.job?.state, "error");
  assert.match(edited.job?.error ?? "", /не отвечал/);
  await rejects(setScriptFromRunner(p.id, old.id, dialog), 409);
  assert.equal(getProject(p.id)!.script, null);

  const replaced = await enqueue(p.id, "script");
  assert.notEqual(replaced.job?.id, old.id);
  await rejects(reportProgress(p.id, old.id, "я вернулся", 50), 409);
  await rejects(setScriptFromRunner(p.id, old.id, dialog), 409);
  await rejects(completeJob(p.id, old.id, {}), 409);
  const fresh = (await claimNext())!;
  assert.equal(fresh.job.id, replaced.job?.id);

  // пульс оживляет задачу, если её ещё не заменили
  ageHeartbeat(p.id, STALE_MS + 1000);
  assert.ok(isLost(getProject(p.id)!.job));
  await reportProgress(p.id, fresh.job.id, "живой", 10);
  assert.equal(isLost(getProject(p.id)!.job), false);
});

test("очередь: сначала самая старая задача, одна задача — одному контейнеру", async () => {
  freshRoot();
  const a = await createProject("Первая тема");
  await new Promise((r) => setTimeout(r, 5));
  const b = await createProject("Вторая тема");
  const [x, y] = await Promise.all([claimNext(), claimNext()]);
  assert.equal(x?.project.id, a.id);
  assert.equal(y?.project.id, b.id);
  assert.equal(await claimNext(), null);
});

test("одновременные изменения не теряются и не ломают файл", async () => {
  freshRoot();
  const p = await createProject("Параллельные вызовы");
  const { job } = (await claimNext())!;
  await Promise.all(Array.from({ length: 25 }, (_, i) => reportProgress(p.id, job.id, `шаг ${i}`, i)));
  const after = getProject(p.id)!;
  assert.equal(after.job?.step, "шаг 24", "изменения применились по порядку");
  assert.equal(after.job?.progress, 24);
  const leftovers = fs.readdirSync(projectDir(p.id)).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("отмена задачи в очереди и удаление проекта", async () => {
  freshRoot();
  const p = await createProject("Удаление");
  await rejects(cancelQueued("../../etc"), 400);
  const cancelled = await cancelQueued(p.id);
  assert.equal(cancelled.job, null);
  await rejects(cancelQueued(p.id), 409);
  assert.equal(await claimNext(), null);

  await enqueue(p.id, "script");
  await removeProject(p.id); // задача в очереди удалению не мешает
  assert.equal(getProject(p.id), null);
  assert.ok(!fs.existsSync(projectDir(p.id)));
  await rejects(removeProject(p.id), 404);
  await rejects(patchProject(p.id, { topic: "нет такого" }), 404);

  // контейнер, работавший над удалённым проектом, получает «задача не актуальна»
  const q = await createProject("Удаление при пропаже");
  const { job } = (await claimNext())!;
  ageHeartbeat(q.id, STALE_MS + 1000);
  await removeProject(q.id);
  await rejects(reportProgress(q.id, job.id, "шаг", 5), 409);
  await rejects(completeJob(q.id, job.id, {}), 409);
});

test("id из адреса не выводят за папку раздела", async () => {
  const root = freshRoot();
  for (const bad of ["", "../x", "..", "abc", "abc/def", "ABCDEFGH", "abc..def", "a".repeat(41), "abc def", "%2e%2e%2f", "c:\\x\\y", null, 42]) {
    assert.equal(isProjectId(bad), false, String(bad));
  }
  assert.throws(() => projectDir("../../data"), /Недопустимый id/);
  assert.equal(getProject("../../db"), null);
  await rejects(patchProject("../../db", { topic: "взлом" }), 400);
  await rejects(enqueue("..\\..\\x", "script"), 400);
  await rejects(removeProject("/etc/passwd"), 400);
  await rejects(reportProgress("..", "job", "шаг", 1), 400);
  assert.equal(path.dirname(projectDir("abc-123")), path.resolve(root));
});

test("создание: проверка идеи и пожеланий", async () => {
  freshRoot();
  await rejects(createProject("ab"), 400, /от 3 до 600/);
  await rejects(createProject("а".repeat(601)), 400);
  await rejects(createProject(42), 400);
  await rejects(createProject("Нормальная тема", "п".repeat(1001)), 400, /Пожелания/);
  await rejects(createProject("Нормальная тема", 5), 400);
  const p = await createProject("Нормальная тема", "   ");
  assert.equal(p.notes, undefined);
  assert.equal(listProjects().length, 1);
});

test("checkScript для редактора: проблемы списком, текст чистится", () => {
  const ok = checkScript({ title: "  Тест ", lines: [{ who: "me", text: " раз\n два " }, { who: "claude", text: "[laughs] три" }] }, 2);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.script, { title: "Тест", lines: [{ who: "me", text: "раз два" }, { who: "claude", text: "[laughs] три" }] });
  const bad = checkScript({ lines: [{ who: "me", text: "" }, { who: "x", text: "[шепчет] привет" }] }, 2);
  assert.equal(bad.script, null);
  assert.equal(bad.problems.length, 3);
});

// ---- озвучка своим голосом

/** WAV с синусом: настоящий звук для ffmpeg, без файлов на диске. amp 0 — цифровая тишина. */
function wav(seconds: number, amp = 0.4, rate = 16000): Buffer {
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * amp * 32767), i * 2);
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

/** Для реплик раннера сайт смотрит только на сигнатуру mp3 — звук внутри не декодируется. */
const fakeMp3 = (size = 600) => Buffer.concat([Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000", "latin1"), Buffer.alloc(size)]);

const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const tmpLeftovers = () => {
  try {
    return fs.readdirSync(path.join(studio3dRoot(), ".tmp"));
  } catch {
    return [];
  }
};

const myKeys = () => ownLines(dialog).map((l) => l.key);

/** Проект со сценарием `dialog` и без задачи. */
async function scripted(topic = "Свой голос") {
  const p = await createProject(topic);
  await writeScript(p.id);
  return p;
}

test("ключ реплики: только слова, без тегов, регистра и ё", () => {
  const k = lineKey("[sighs] Всё — это СКОЛЬКО?!");
  assert.ok(isLineKey(k), k);
  assert.match(k, /^[a-z0-9]{10,14}$/);
  assert.equal(lineKey("все это сколько"), k);
  assert.equal(lineKey("  Всё,   это [laughs] сколько "), k);
  assert.notEqual(lineKey("Всё — это много?"), k);
  // реплика из одного тега ключуется по тегу
  assert.notEqual(lineKey("[laughs]"), lineKey("[sighs]"));
  assert.equal(lineKey("[laughs]"), lineKey("[ Laughs ]"));
  assert.ok(isLineKey(lineKey("...")));
  for (const bad of ["", "ABCDEFGHIJ", "abc", "a".repeat(15), "../../etc", null, 5]) assert.equal(isLineKey(bad), false, String(bad));

  assert.deepEqual(
    ownLines(dialog).map((l) => l.index),
    [0, 2],
  );
  const empty = dubProgress(dialog, { version: 0, takes: {} });
  assert.deepEqual(empty, { total: 2, recorded: 0, missing: [0, 2], stale: [] });
});

test("формат записи узнаётся по сигнатуре, а не по Content-Type", () => {
  const pad = (head: number[] | string) => Buffer.concat([typeof head === "string" ? Buffer.from(head, "latin1") : Buffer.from(head), Buffer.alloc(16)]);
  assert.equal(sniffAudio(pad([0x1a, 0x45, 0xdf, 0xa3])), "webm");
  assert.equal(sniffAudio(pad("OggS")), "ogg");
  assert.equal(sniffAudio(pad("\u0000\u0000\u0000\u001cftypM4A ")), "mp4");
  assert.equal(sniffAudio(wav(0.01)), "wav");
  assert.equal(sniffAudio(fakeMp3()), "mp3");
  assert.equal(sniffAudio(pad([0xff, 0xfb, 0x90, 0x64])), "mp3", "кадр MPEG без ID3");
  assert.equal(sniffAudio(pad([0xff, 0xf1, 0x50, 0x80])), null, "ADTS AAC — не mp3");
  assert.equal(sniffAudio(pad("<!doctype html>")), null);
  assert.equal(sniffAudio(Buffer.from("ID3")), null, "слишком короткий файл");
});

test("статусы реплик: записано, нет, устарело", () => {
  const take = (text: string) => ({ key: lineKey(text), take: 1, text, file: "x", bytes: 1, sha256: "x", duration: 1, peakDb: -3, at: "", scriptVersion: 1 });
  const old = take("Все сорок тысяч рублей.");
  const dub = { version: 1, takes: { [old.key]: old, [take(dialog.lines[0].text).key]: take(dialog.lines[0].text) } };
  const edited: Script3D = { ...dialog, lines: [dialog.lines[0], dialog.lines[1], { who: "me", text: "Все сорок тысяч долларов." }] };
  assert.deepEqual(
    dubLines(edited, dub).map((l) => l.status),
    ["recorded", "stale"],
    "переписанная реплика помечается устаревшей",
  );
  const other: Script3D = { ...dialog, lines: [dialog.lines[0], dialog.lines[1], { who: "me", text: "Совсем другая мысль про эфир." }] };
  assert.deepEqual(
    dubLines(other, dub).map((l) => l.status),
    ["recorded", "missing"],
  );
  const progress = dubProgress(edited, dub);
  assert.equal(progress.recorded, 1);
  assert.deepEqual(progress.missing, [2]);
  assert.deepEqual(progress.stale, [old.key]);
});

test("старый project.json получает новые поля по умолчанию", async () => {
  freshRoot();
  const p = await createProject("Старый проект");
  const file = path.join(projectDir(p.id), "project.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const k of ["ownVoice", "dub", "clips", "meta", "cover", "mirrorId"]) delete raw[k];
  fs.writeFileSync(file, JSON.stringify(raw));
  const read = getProject(p.id)!;
  assert.equal(read.ownVoice, false);
  assert.deepEqual(read.dub, { version: 0, takes: {} });
  assert.deepEqual(read.clips, {});
  assert.equal(read.meta, null);
  assert.equal(read.cover, null);
  assert.equal(read.mirrorId, null);
  assert.deepEqual(toSummary(read).dub, { total: 0, recorded: 0 });
});

test("запись своей реплики: проверки, FLAC, перезапись и удаление", async () => {
  freshRoot();
  sniffAudio(Buffer.alloc(0)); // пустой буфер не роняет определение формата
  const p = await scripted();
  const [k0, k2] = myKeys();
  const claudeKey = lineKey(dialog.lines[1].text);

  await rejects(saveDubTake(p.id, "../x", wav(1)), 400, /ключ/);
  await rejects(saveDubTake(p.id, k0, Buffer.alloc(0)), 400, /Пустая/);
  await rejects(saveDubTake(p.id, k0, Buffer.alloc(MAX_DUB_BYTES + 1)), 413);
  await rejects(saveDubTake(p.id, k0, Buffer.from("это не звук, а просто текст")), 415);
  await rejects(saveDubTake(p.id, claudeKey, wav(1)), 409, /больше нет/);
  await rejects(saveDubTake(p.id, k0, wav(1, 0)), 400, /беззвучн/);
  await rejects(saveDubTake(p.id, k0, wav(0.1)), 400, /от 0,3 до 60/);
  await rejects(saveDubTake(p.id, k0, wav(61.5, 0.4, 8000)), 400, /от 0,3 до 60/);
  // формат узнан, но внутри мусор
  await rejects(saveDubTake(p.id, k0, Buffer.concat([Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVE", "latin1"), Buffer.alloc(64, 7)])), 400, /не читается/);
  assert.deepEqual(getProject(p.id)!.dub, { version: 0, takes: {} });
  assert.deepEqual(tmpLeftovers(), [], "временные файлы убраны и после отказов");

  const first = await saveDubTake(p.id, k0, wav(1.2));
  const t1 = first.dub!.takes[k0];
  assert.equal(t1.take, 1);
  assert.equal(t1.file, `dub/${k0}.1.flac`);
  assert.equal(t1.text, dialog.lines[0].text);
  assert.ok(Math.abs(t1.duration - 1.2) < 0.05, String(t1.duration));
  assert.ok(t1.peakDb > -12 && t1.peakDb <= 0, String(t1.peakDb));
  assert.equal(first.dub!.version, 1);
  const f1 = path.join(projectDir(p.id), t1.file);
  assert.equal(fs.readFileSync(f1).subarray(0, 4).toString("latin1"), "fLaC");
  assert.equal(t1.sha256, sha(f1));
  assert.equal(t1.bytes, fs.statSync(f1).size);
  // длительность из заголовка FLAC совпадает с ffprobe
  const probed = await probe(f1);
  assert.ok(Math.abs(probed.duration - t1.duration) < 0.01, `${probed.duration} vs ${t1.duration}`);
  assert.ok(Math.abs(probed.peakDb - t1.peakDb) < 0.5);
  assert.equal(dubTakeFile(p.id, k0)?.file, f1);
  assert.deepEqual(toSummary(first).dub, { total: 2, recorded: 1 });

  const second = await saveDubTake(p.id, k0, wav(0.8));
  assert.equal(second.dub!.takes[k0].take, 2);
  assert.equal(second.dub!.version, 2);
  assert.ok(!fs.existsSync(f1), "прошлый дубль удалён");
  assert.ok(fs.existsSync(path.join(projectDir(p.id), `dub/${k0}.2.flac`)));

  // одновременные дубли одной реплики: оба приняты по очереди, файл остаётся один
  const [a, b] = await Promise.all([saveDubTake(p.id, k2, wav(0.6)), saveDubTake(p.id, k2, wav(0.7))]);
  assert.deepEqual([a.dub!.takes[k2].take, b.dub!.takes[k2].take].sort(), [1, 2]);
  assert.deepEqual(fs.readdirSync(path.join(projectDir(p.id), "dub")).filter((f) => f.startsWith(k2)), [`${k2}.2.flac`]);
  assert.equal(getProject(p.id)!.dub!.version, 4);

  const removed = await removeDubTake(p.id, k0);
  assert.equal(removed.dub!.takes[k0], undefined);
  assert.equal(removed.dub!.version, 5);
  assert.ok(!fs.existsSync(path.join(projectDir(p.id), `dub/${k0}.2.flac`)));
  await rejects(removeDubTake(p.id, k0), 404);
  await rejects(removeDubTake(p.id, "nope"), 400);
  assert.deepEqual(tmpLeftovers(), []);
});

test("«Мой голос»: монтаж только когда записаны все твои реплики, план для раннера", async () => {
  freshRoot();
  const p = await scripted();
  const [k0, k2] = myKeys();
  await rejects(patchProject(p.id, { ownVoice: "да" }), 400, /Мой голос/);
  const on = await patchProject(p.id, { ownVoice: true });
  assert.equal(on.ownVoice, true);
  assert.equal(on.scriptVersion, 1, "флаг — не правка сценария");
  assert.equal(toSummary(on).ownVoice, true);

  await rejects(enqueue(p.id, "montage"), 400, /не записаны реплики 1 и 3/);
  await saveDubTake(p.id, k0, wav(1));
  await rejects(enqueue(p.id, "montage"), 400, /не записана реплика 3/);
  const ready = await saveDubTake(p.id, k2, wav(1));

  const queued = await enqueue(p.id, "montage");
  // пока монтаж в очереди или идёт, записи не меняются
  await rejects(saveDubTake(p.id, k0, wav(1)), 409, /Идёт монтаж/);
  await rejects(removeDubTake(p.id, k0), 409, /Идёт монтаж/);
  await rejects(patchProject(p.id, { ownVoice: false }), 409);

  const claimed = (await claimNext())!;
  assert.equal(claimed.job.id, queued.job!.id);
  const plan = claimed.voice!;
  assert.deepEqual(plan.keys, dialog.lines.map((l) => lineKey(l.text)));
  assert.equal(plan.ownVoice, true);
  assert.equal(plan.dubVersion, ready.dub!.version);
  assert.deepEqual(
    plan.lines.map((l) => [l.index, l.key, l.take, l.text]),
    [
      [0, k0, 1, dialog.lines[0].text],
      [2, k2, 1, dialog.lines[2].text],
    ],
  );
  assert.equal(plan.lines[0].sha256, ready.dub!.takes[k0].sha256);
  assert.equal(plan.lines[0].bytes, ready.dub!.takes[k0].bytes);

  // раннер скачивает именно тот дубль, что в плане
  const got = runnerDubTake(p.id, claimed.job.id, k0, 1);
  assert.equal(got.sha256, sha(got.file));
  assert.throws(() => runnerDubTake(p.id, claimed.job.id, k0, 2), (e: any) => e.status === 409);
  assert.throws(() => runnerDubTake(p.id, "other-job-1", k0, 1), (e: any) => e.status === 409);
  assert.throws(() => runnerDubTake(p.id, claimed.job.id, lineKey(dialog.lines[1].text), 1), (e: any) => e.status === 409);

  await receiveVideoChunk(p.id, claimed.job.id, 0, 4, Buffer.from("mp4!"));
  const done = await completeJob(p.id, claimed.job.id, { video: { duration: 9, scriptVersion: 1, ownVoice: true, dubVersion: plan.dubVersion } });
  assert.equal(done.video?.ownVoice, true);
  assert.equal(done.video?.dubVersion, plan.dubVersion);
  // законченный монтаж больше не отдаёт записи
  assert.throws(() => runnerDubTake(p.id, claimed.job.id, k0, 1), (e: any) => e.status === 409);

  // без своего голоса план не содержит записей, а видео — отметки
  await patchProject(p.id, { ownVoice: false });
  await enqueue(p.id, "montage");
  const synth = (await claimNext())!;
  assert.equal(synth.voice!.ownVoice, false);
  assert.deepEqual(synth.voice!.lines, []);
  await receiveVideoChunk(p.id, synth.job.id, 0, 4, Buffer.from("mp4?"));
  const plain = await completeJob(p.id, synth.job.id, { video: { duration: 9, scriptVersion: 1 } });
  assert.equal(plain.video?.ownVoice, undefined);
  assert.equal(plain.video?.dubVersion, undefined);
});

test("«Мой голос» без записи в очереди (project.json правили руками) — задача с ошибкой, раннер её не получает", async () => {
  freshRoot();
  const p = await scripted();
  await patchProject(p.id, { ownVoice: true });
  for (const k of myKeys()) await saveDubTake(p.id, k, wav(0.5));
  await enqueue(p.id, "montage");
  const file = path.join(projectDir(p.id), "project.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Project3D;
  raw.dub!.takes = {};
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal(await claimNext(), null);
  const after = getProject(p.id)!;
  assert.equal(after.job?.state, "error");
  assert.match(after.job?.error ?? "", /не все/i);
});

test("подсказки: задача voice, реплики раннера, проверка полноты, уборка старых", async () => {
  freshRoot();
  const p = await scripted();
  await patchProject(p.id, { script: { title: "", lines: [dialog.lines[0]] } });
  await rejects(enqueue(p.id, "voice"), 400, /подсказок/);
  await patchProject(p.id, { script: dialog, ownVoice: true });

  const queued = await enqueue(p.id, "voice");
  assert.equal(queued.job?.task, "voice");
  // запись своих реплик во время подсказок не мешает
  await saveDubTake(p.id, myKeys()[0], wav(0.5));
  const claimed = (await claimNext())!;
  const plan = claimed.voice!;
  assert.equal(plan.ownVoice, false, "подсказки озвучивают все реплики, свой голос им не нужен");
  assert.deepEqual(plan.lines, []);
  assert.equal(plan.keys.length, 3);
  assert.equal(statusOf(toSummary(getProject(p.id)!)).text, "Готовит подсказки");

  const [k0, k1, k2] = plan.keys;
  await rejects(saveLineClip(p.id, "other-job-1", k0, fakeMp3(), 1.5), 409);
  await rejects(saveLineClip(p.id, claimed.job.id, "../evil", fakeMp3(), 1.5), 400);
  await rejects(saveLineClip(p.id, claimed.job.id, k0, wav(0.5), 1.5), 415);
  await rejects(saveLineClip(p.id, claimed.job.id, k0, Buffer.alloc(MAX_CLIP_BYTES + 1), 1.5), 413);
  await rejects(saveLineClip(p.id, claimed.job.id, k0, fakeMp3(), "x"), 400, /длительность/);
  await rejects(saveLineClip(p.id, claimed.job.id, lineKey("такой реплики нет"), fakeMp3(), 1.5), 400);

  const clip = await saveLineClip(p.id, claimed.job.id, k1, fakeMp3(), 2.3456);
  assert.deepEqual(
    { key: clip.key, who: clip.who, text: clip.text, file: clip.file, duration: clip.duration },
    { key: k1, who: "claude", text: dialog.lines[1].text, file: `clips/${k1}.mp3`, duration: 2.346 },
  );
  assert.equal(lineClipFile(p.id, k1)?.file, path.join(projectDir(p.id), "clips", `${k1}.mp3`));
  await saveLineClip(p.id, claimed.job.id, k0, fakeMp3(), 1.5);
  // не все реплики — задача с ошибкой
  const partial = await completeJob(p.id, claimed.job.id, {});
  assert.equal(partial.job?.state, "error");
  assert.match(partial.job?.error ?? "", /2 из 3/);
  // монтаж своим голосом запрещён, пока не записана реплика 3
  await rejects(enqueue(p.id, "montage"), 400, /реплика 3/);

  await enqueue(p.id, "voice");
  const again = (await claimNext())!;
  for (const k of [k0, k1, k2]) await saveLineClip(p.id, again.job.id, k, fakeMp3(), 1);
  const done = await completeJob(p.id, again.job.id, {});
  assert.equal(done.job?.state, "done");
  assert.deepEqual(Object.keys(done.clips!).sort(), [k0, k1, k2].sort());
  // после подсказок видео (если было) по-прежнему «готово»
  assert.equal(statusOf({ ...toSummary(done), video: { file: "out.mp4", at: "", duration: 1, scriptVersion: 1 } }).text, "Готово");

  // сценарий изменился: новые подсказки, старая реплика Клода убирается с диска
  const changed: Script3D = { ...dialog, lines: [dialog.lines[0], { who: "claude", text: "[laughs] А на еду?" }, dialog.lines[2]] };
  await patchProject(p.id, { script: changed });
  await enqueue(p.id, "voice");
  const third = (await claimNext())!;
  for (const k of third.voice!.keys) await saveLineClip(p.id, third.job.id, k, fakeMp3(), 1);
  const cleaned = await completeJob(p.id, third.job.id, {});
  assert.equal(cleaned.clips![k1], undefined);
  assert.ok(!fs.existsSync(path.join(projectDir(p.id), "clips", `${k1}.mp3`)));
  assert.equal(Object.keys(cleaned.clips!).length, 3);
  assert.deepEqual(tmpLeftovers(), []);
});

/** Раннер «озвучивает» реплики со словами — по одной на ключ, первую (как runner/index.ts), — и заканчивает задачу. */
async function voiceAll(id: string, script: Script3D) {
  await enqueue(id, "voice");
  const claimed = (await claimNext())!;
  assert.equal(claimed.job.task, "voice");
  const sent = new Set<string>();
  script.lines.forEach((l, i) => {
    if (hasWords(l.text)) sent.add(claimed.voice!.keys[i]);
  });
  for (const key of sent) await saveLineClip(id, claimed.job.id, key, fakeMp3(), 1);
  return completeJob(id, claimed.job.id, {});
}

test("реплики из одних тегов: ни подсказки, ни записи им не нужны", async () => {
  freshRoot();
  const tagged: Script3D = {
    title: "Теги",
    lines: [
      { who: "me", text: "Клод, я купил монету на все деньги." },
      { who: "claude", text: "[laughs]" },
      { who: "me", text: "Что смешного?" },
      { who: "claude", text: "Ничего… [sighs]" },
      { who: "me", text: "[pause]" },
    ],
  };
  assert.deepEqual(
    tagged.lines.map((l) => hasWords(l.text)),
    [true, false, true, true, false],
  );
  assert.equal(hasWords("[long pause] 42"), true, "цифры — тоже слова");
  assert.deepEqual(missingClips(tagged, {}), [0, 2, 3]);
  assert.deepEqual(dubProgress(tagged, { version: 0, takes: {} }), { total: 2, recorded: 0, missing: [0, 2], stale: [] });
  assert.deepEqual(
    dubLines(tagged, { version: 0, takes: {} }).map((l) => [l.index, l.status]),
    [
      [0, "missing"],
      [2, "missing"],
      [4, "optional"],
    ],
  );

  const p = await createProject("Реплики из тегов");
  const first = (await claimNext())!;
  await setScriptFromRunner(p.id, first.job.id, tagged);
  await completeJob(p.id, first.job.id, {});

  // раннер не озвучивает [laughs] и [pause] — задача всё равно готова
  const voiced = await voiceAll(p.id, tagged);
  assert.equal(voiced.job?.state, "done", voiced.job?.error ?? "");
  assert.deepEqual(missingClips(voiced.script, voiced.clips), []);
  // озвучил и реплику из тега — сайт её принимает, но не требует
  await enqueue(p.id, "voice");
  const extra = (await claimNext())!;
  for (const [i, key] of extra.voice!.keys.entries()) if (i !== 4) await saveLineClip(p.id, extra.job.id, key, fakeMp3(), 1);
  assert.equal((await completeJob(p.id, extra.job.id, {})).job?.state, "done");

  // «Мой голос»: нужны записи только реплик 1 и 3
  await patchProject(p.id, { ownVoice: true });
  const [k0, k2, kPause] = ownLines(tagged).map((l) => l.key);
  await rejects(enqueue(p.id, "montage"), 400, /не записаны реплики 1 и 3/);
  await saveDubTake(p.id, k0, wav(0.6));
  await saveDubTake(p.id, k2, wav(0.6));
  assert.deepEqual(toSummary(getProject(p.id)!).dub, { total: 2, recorded: 2 });
  await enqueue(p.id, "montage");
  const montage = (await claimNext())!;
  assert.deepEqual(
    montage.voice!.lines.map((l) => l.index),
    [0, 2],
    "для [pause] записи нет — и не нужна",
  );
  await completeJob(p.id, montage.job.id, { error: "стоп" });

  // записанную всё же паузу монтаж использует
  await saveDubTake(p.id, kPause, wav(0.6));
  const withTake = getProject(p.id)!;
  assert.equal(dubLines(withTake.script, withTake.dub)[2].status, "recorded");
  await enqueue(p.id, "montage");
  const withPause = (await claimNext())!;
  assert.deepEqual(
    withPause.voice!.lines.map((l) => l.index),
    [0, 2, 4],
  );
});

test("подсказка засчитывается только голосу своей реплики", async () => {
  freshRoot();
  const p = await scripted("Смена говорящего");
  const swapped: Script3D = { ...dialog, lines: [dialog.lines[0], { who: "me", text: dialog.lines[1].text }, dialog.lines[2]] };
  const before = await voiceAll(p.id, dialog);
  assert.equal(before.job?.state, "done");
  const k1 = lineKey(dialog.lines[1].text);
  assert.equal(before.clips![k1].who, "claude");

  // реплику Клода отдали владельцу: слова те же, ключ тот же, но подсказка озвучена не тем голосом
  const changed = await patchProject(p.id, { script: swapped });
  assert.equal(clipFor(changed.clips, swapped.lines[1]), null);
  assert.deepEqual(missingClips(changed.script, changed.clips), [1], "страница предложит подготовить подсказки");
  const revoiced = await voiceAll(p.id, swapped);
  assert.equal(revoiced.job?.state, "done", revoiced.job?.error ?? "");
  assert.equal(revoiced.clips![k1].who, "me");
  assert.ok(clipFor(revoiced.clips, swapped.lines[1]));
  assert.deepEqual(missingClips(revoiced.script, revoiced.clips), []);

  // одни и те же слова у обоих: подсказка одна — первого, второй реплике её нет, но и задача не падает
  const echo: Script3D = {
    title: "Эхо",
    lines: [
      { who: "me", text: "Да." },
      { who: "claude", text: "[sighs] Да!" },
      { who: "me", text: "Что «да»?" },
    ],
  };
  await patchProject(p.id, { script: echo });
  assert.deepEqual(missingClips(echo, {}), [0, 2]);
  const echoed = await voiceAll(p.id, echo);
  assert.equal(echoed.job?.state, "done", echoed.job?.error ?? "");
  assert.equal(echoed.clips![lineKey("Да.")].who, "me");
  assert.equal(clipFor(echoed.clips, echo.lines[1]), null);

  // а если раннер прислал не все реплики — ошибка с номерами
  await enqueue(p.id, "voice");
  const partial = (await claimNext())!;
  await saveLineClip(p.id, partial.job.id, lineKey("Да."), fakeMp3(), 1);
  // подсказку реплики 3 от прошлого раза убираем прямо из project.json
  const file = path.join(projectDir(p.id), "project.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Project3D;
  delete raw.clips![lineKey("Что «да»?")];
  fs.writeFileSync(file, JSON.stringify(raw));
  const failed = await completeJob(p.id, partial.job.id, {});
  assert.equal(failed.job?.state, "error");
  assert.match(failed.job?.error ?? "", /1 из 2.*нет реплики 3/);
});

test("старые записи: видны, удаляются кнопкой, убираются сами при монтаже и после подсказок", async () => {
  freshRoot();
  const p = await scripted("Старые записи");
  const [k0, k2] = myKeys();
  await saveDubTake(p.id, k0, wav(0.6));
  const recorded = await saveDubTake(p.id, k2, wav(0.6));
  const version = recorded.dub!.version;
  const k2File = path.join(projectDir(p.id), recorded.dub!.takes[k2].file);
  assert.ok(fs.existsSync(k2File));

  // реплику 3 переписали: её запись устарела и видна странице
  const rewritten: Script3D = { ...dialog, lines: [dialog.lines[0], dialog.lines[1], { who: "me", text: "Все сорок тысяч долларов." }] };
  const edited = await patchProject(p.id, { script: rewritten });
  assert.deepEqual(
    staleTakes(edited.script, edited.dub).map((t) => t.key),
    [k2],
  );

  // кнопка «удалить» у старой записи: файл и запись уходят, версия набора не меняется
  const removed = await removeDubTake(p.id, k2);
  assert.equal(removed.dub!.takes[k2], undefined);
  assert.equal(removed.dub!.version, version, "старая запись не входила в текущий набор");
  assert.ok(!fs.existsSync(k2File));
  assert.deepEqual(staleTakes(removed.script, removed.dub), []);

  // монтаж убирает старые записи сам
  await patchProject(p.id, { script: dialog });
  const again = await saveDubTake(p.id, k2, wav(0.6));
  const againFile = path.join(projectDir(p.id), again.dub!.takes[k2].file);
  await patchProject(p.id, { script: rewritten });
  const queued = await enqueue(p.id, "montage");
  assert.equal(queued.dub!.takes[k2], undefined);
  assert.ok(queued.dub!.takes[k0], "запись живой реплики остаётся");
  assert.equal(queued.dub!.version, again.dub!.version);
  assert.ok(!fs.existsSync(againFile));
  assert.equal(getProject(p.id)!.dub!.takes[k2], undefined);
  const montage = (await claimNext())!;
  await completeJob(p.id, montage.job.id, { error: "стоп" });

  // и законченные подсказки — тоже, даже неудачные
  const k0File = path.join(projectDir(p.id), getProject(p.id)!.dub!.takes[k0].file);
  await patchProject(p.id, { script: { ...rewritten, lines: [{ who: "me", text: "Совсем новая первая реплика." }, ...rewritten.lines.slice(1)] } });
  await enqueue(p.id, "voice");
  const voice = (await claimNext())!;
  const failed = await completeJob(p.id, voice.job.id, { error: "ElevenLabs недоступен" });
  assert.equal(failed.job?.state, "error");
  assert.deepEqual(failed.dub!.takes, {});
  assert.ok(!fs.existsSync(k0File));
  assert.deepEqual(fs.readdirSync(path.join(projectDir(p.id), "dub")), []);
});

// ---- озвучка поверх ролика: разметка реплик, дубли с отметками, сборка с голосом владельца

/** Где звучит каждая реплика `dialog` в 7-секундном ролике. */
const windows: VideoLine[] = [
  { index: 0, who: "me", start: 0.2, end: 2.4 },
  { index: 1, who: "claude", start: 2.6, end: 4.1 },
  { index: 2, who: "me", start: 4.3, end: 6 },
];

/**
 * Монтаж «контейнером» до конца: out.mp4 и длительность; lines — что прислал исполнитель, extra — прочее о ролике.
 * Окна по умолчанию — по звуку (как у нынешнего монтажа); окна по буквам — явным extra без linesVersion.
 */
async function montaged(id: string, lines?: unknown, duration = 7, extra: Record<string, unknown> = lines === undefined ? {} : { linesVersion: LINES_VERSION }) {
  const queued = await enqueue(id, "montage");
  const { job } = (await claimNext())!;
  await receiveVideoChunk(id, job.id, 0, 4, Buffer.from("mp4!"));
  return completeJob(id, job.id, { video: { duration, scriptVersion: queued.scriptVersion, ...(lines === undefined ? {} : { lines }), ...extra } });
}

/** Отметки дубля реплики i поверх текущего ролика: запись начата за DUB_PRE_ROLL до реплики, задержка 40 мс. */
function metaFor(p: Project3D, i: number, change: Record<string, unknown> = {}) {
  const w = p.video!.lines!.find((l) => l.index === i)!;
  return { videoStart: w.start - DUB_PRE_ROLL - 0.04, latencyMs: 40, lineStart: w.start, lineEnd: w.end, videoAt: p.video!.at, ...change };
}

test("разметка реплик: монтаж хранит окна, неверные не принимаются", async () => {
  freshRoot();
  const p = await scripted("Разметка");
  const done = await montaged(p.id, windows);
  assert.deepEqual(done.video?.lines, windows);
  assert.equal(videoWindows(done).size, 3);

  assert.deepEqual(checkWindows([...windows].reverse(), dialog, 7), windows, "по порядку реплик");
  assert.deepEqual(checkWindows([{ index: 0, who: "me", start: 0.12345, end: 1.98765 }], dialog, 7), [{ index: 0, who: "me", start: 0.123, end: 1.988 }]);
  const bad: unknown[] = [
    [],
    "окна",
    [{ ...windows[0], index: 3 }],
    [{ ...windows[0], index: 0.5 }],
    [{ ...windows[0], who: "claude" }],
    [{ ...windows[0], who: "donkey" }],
    [{ ...windows[0], start: -0.1 }],
    [{ ...windows[0], start: 2, end: 2 }],
    [{ ...windows[0], end: 7.6 }],
    [{ ...windows[0], start: "0.2" }],
    [windows[0], windows[0]],
    [windows[0], null],
  ];
  for (const b of bad) assert.equal(checkWindows(b, dialog, 7), null, JSON.stringify(b));
  assert.ok(checkWindows([{ ...windows[2], end: 7.5 }], dialog, 7), "конец на полсекунды дальше ролика допустим");

  // неверная разметка не портит ролик: он сохраняется, но без окон
  const noLines = await montaged(p.id, [{ ...windows[0], index: 9 }]);
  assert.equal(noLines.job?.state, "done");
  assert.ok(noLines.video);
  assert.equal(noLines.video!.lines, undefined);
  assert.equal(voiceOverProgress(noLines).problem, "в ролике нет разметки реплик");
});

test("разметка старого ролика приходит с подсказками, только для этого ролика", async () => {
  freshRoot();
  const p = await scripted("Старый ролик");
  const old = await montaged(p.id);
  assert.equal(old.video?.lines, undefined);
  const voiceJob = async (videoLines: unknown) => {
    await enqueue(p.id, "voice");
    const { job } = (await claimNext())!;
    return completeJob(p.id, job.id, { videoLines });
  };
  // монтаж в папке исполнителя — другой ролик (другая длина): разметку не берём
  let after = await voiceJob({ videoDuration: 7.3, lines: windows });
  assert.equal(after.video?.lines, undefined);
  assert.equal(after.job?.state, "error", "подсказки без реплик — ошибка, но разметка от неё не зависит");
  after = await voiceJob({ videoDuration: 7.1, lines: [{ ...windows[0], who: "claude" }] });
  assert.equal(after.video?.lines, undefined, "неверная разметка не принимается");
  after = await voiceJob({ videoDuration: 6.9, lines: windows });
  assert.deepEqual(after.video?.lines, windows);
  assert.equal(after.video?.at, old.video?.at, "ролик тот же");
  // у ролика уже есть разметка: вторая её не заменяет
  after = await voiceJob({ videoDuration: 7, lines: [windows[0]] });
  assert.deepEqual(after.video?.lines, windows);

  // сценарий изменён после монтажа: окна относятся к старому сценарию
  const q = await scripted("Старый ролик 2");
  await montaged(q.id);
  await patchProject(q.id, { script: { ...dialog, lines: [dialog.lines[0], dialog.lines[1]] } });
  await enqueue(q.id, "voice");
  const { job } = (await claimNext())!;
  const edited = await completeJob(q.id, job.id, { videoLines: { videoDuration: 7, lines: windows } });
  assert.equal(edited.video?.lines, undefined);
});

/**
 * Окна того же ролика, найденные по звуку: у первой реплики сыгранный вздох перед словами и хвост последнего слова
 * (сдвиг меньше прежнего допуска 0,05 с — запись по старому окну всё равно устаревает), Клод тоже уточнён,
 * третья реплика совпала до миллисекунды.
 */
const sound: VideoLine[] = [
  { index: 0, who: "me", start: 0.18, end: 2.43 },
  { index: 1, who: "claude", start: 2.55, end: 4.2 },
  { index: 2, who: "me", start: 4.3, end: 6 },
];

test("разметка по звуку заменяет старую: только более новая, того же ролика и целиком; записи по старой устаревают, но остаются", async () => {
  freshRoot();
  const p = await scripted("Разметка по звуку");
  const [k0, k2] = myKeys();
  const v = await montaged(p.id, windows, 7, {});
  assert.equal(v.video!.linesVersion, undefined);
  assert.equal(linesVersionOf(v.video), 1, "нет версии — по буквам");
  const voiceJob = async (videoLines: unknown) => {
    await enqueue(p.id, "voice");
    const { job } = (await claimNext())!;
    return completeJob(p.id, job.id, { videoLines });
  };
  // исполнитель не нашёл окон по звуку: записывать по буквам можно (так записаны и дубли до уточнения разметки)
  await voiceJob(undefined);
  await saveDubTake(p.id, k0, wav(3), metaFor(v, 0));
  const before = await saveDubTake(p.id, k2, wav(3), metaFor(v, 2));
  assert.deepEqual(
    voiceOverLines(before).map((l) => l.status),
    ["recorded", null, "recorded"],
  );
  const files = Object.values(before.dub!.takes).map((t) => path.join(projectDir(p.id), t.file));

  // не новее хранимой (без версии = 1), другой ролик, версия не числом, не все реплики — ничего не меняется
  const ignored: unknown[] = [
    { videoDuration: 7, lines: sound },
    { videoDuration: 7, lines: sound, version: 1 },
    { videoDuration: 7.4, lines: sound, version: LINES_VERSION },
    { videoDuration: 7, lines: sound, version: "2" },
    { videoDuration: 7, lines: sound, version: 1.5 },
    { videoDuration: 7, lines: sound.slice(0, 2), version: LINES_VERSION },
    { videoDuration: 7, lines: [{ ...sound[0], who: "claude" }, sound[1], sound[2]], version: LINES_VERSION },
  ];
  for (const raw of ignored) {
    const after = await voiceJob(raw);
    assert.deepEqual(after.video!.lines, windows, JSON.stringify(raw));
    assert.equal(after.video!.linesVersion, undefined);
  }

  const measured = await voiceJob({ videoDuration: 7.05, lines: sound, version: LINES_VERSION });
  assert.deepEqual(measured.video!.lines, sound);
  assert.equal(measured.video!.linesVersion, LINES_VERSION);
  assert.equal(measured.video!.at, v.video!.at, "ролик тот же");
  assert.equal(measured.job?.state, "error", "подсказки без реплик — ошибка, а разметка от неё не зависит");
  // запись по заменённому окну — «устарело», по совпавшему — по-прежнему записана
  const lines = voiceOverLines(measured);
  assert.deepEqual(
    lines.map((l) => l.status),
    ["stale", null, "recorded"],
  );
  assert.equal(retimed(lines[0], measured.video), true, "страница скажет, что разметка уточнена");
  assert.equal(retimed(lines[2], measured.video), false);
  // ничего не удалено: записи, их файлы и версия набора на месте
  assert.deepEqual(Object.keys(measured.dub!.takes).sort(), [k0, k2].sort());
  for (const f of files) assert.ok(fs.existsSync(f), f);
  assert.equal(measured.dub!.version, before.dub!.version);
  assert.deepEqual(voiceOverProgress(measured), { total: 2, recorded: 1, missing: [0], problem: "не озвучена реплика 1" });
  await rejects(enqueue(p.id, "dub"), 400, /не озвучена реплика 1/);
  assert.match(montageWarning(measured) ?? "", /\(1\)/, "устаревшая запись при новом монтаже уже не теряется");

  // ещё раз та же версия — окна не меняются (вторые подсказки не трогают уточнённую разметку)
  const again = await voiceJob({ videoDuration: 7, lines: windows, version: LINES_VERSION });
  assert.deepEqual(again.video!.lines, sound);
  assert.equal(again.video!.linesVersion, LINES_VERSION);

  // перезапись по новому окну — снова записано, можно собирать
  const fixed = await saveDubTake(p.id, k0, wav(3), metaFor(again, 0));
  assert.equal(fixed.dub!.takes[k0].lineStart, 0.18);
  assert.equal(fixed.dub!.takes[k0].lineEnd, 2.43);
  assert.deepEqual(voiceOverProgress(fixed), { total: 2, recorded: 2, missing: [], problem: null });

  // старый ролик без разметки получает её сразу по звуку, с версией
  const q = await scripted("Без разметки");
  await montaged(q.id);
  await enqueue(q.id, "voice");
  const { job } = (await claimNext())!;
  const backfilled = await completeJob(q.id, job.id, { videoLines: { videoDuration: 7, lines: sound, version: LINES_VERSION } });
  assert.deepEqual(backfilled.video!.lines, sound);
  assert.equal(backfilled.video!.linesVersion, LINES_VERSION);
});

test("окно записи совпадает с окном ролика до миллисекунды", () => {
  const video = { file: "out.mp4", at: "2026-10-22T10:00:00.000Z", duration: 7, scriptVersion: 1, lines: windows };
  const take = { key: "k", take: 1, text: "", file: "", bytes: 1, sha256: "", duration: 3, peakDb: -3, at: "", scriptVersion: 1, videoStart: -0.34, lineStart: 0.2, lineEnd: 2.4, videoAt: video.at };
  assert.equal(takeFits(take, video, windows[0]), true);
  assert.equal(takeFits({ ...take, lineStart: 0.2004 }, video, windows[0]), true, "запись хранит окно с точностью до миллисекунды");
  assert.equal(takeFits({ ...take, lineStart: 0.21 }, video, windows[0]), false, "сдвиг на 10 мс — уже другое окно");
  assert.equal(takeFits({ ...take, lineEnd: 2.43 }, video, windows[0]), false);
  assert.equal(takeFits({ ...take, videoAt: "2026-10-22T09:00:00.000Z" }, video, windows[0]), false);
  assert.equal(takeFits({ ...take, videoStart: undefined }, video, windows[0]), false);
  assert.equal(linesVersionOf({ linesVersion: 2 }), 2);
  for (const bad of [undefined, 0, -1, 1.5, "2", null]) assert.equal(linesVersionOf({ linesVersion: bad }), 1, String(bad));
  assert.equal(linesVersionOf(null), 1);
});

test("версия разметки: монтаж хранит присланную, сборка — свою или прежнюю; записи переезжают на окна сборки", async () => {
  freshRoot();
  const p = await scripted("Версия разметки");
  const [k0, k2] = myKeys();
  // без окон версии нет; версия не числом не хранится
  assert.equal((await montaged(p.id, undefined, 7, { linesVersion: 2 })).video!.linesVersion, undefined);
  assert.equal((await montaged(p.id, windows, 7, { linesVersion: 1.5 })).video!.linesVersion, undefined);
  const v = await montaged(p.id, sound, 7, { linesVersion: LINES_VERSION });
  assert.equal(v.video!.linesVersion, LINES_VERSION);
  for (const [i, key] of myKeys().entries()) await saveDubTake(p.id, key, wav(3), metaFor(v, i * 2));

  const dub = async (video: Record<string, unknown>) => {
    const queued = await enqueue(p.id, "dub");
    const { job, voice } = (await claimNext())!;
    await receiveVideoChunk(p.id, job.id, 0, 4, Buffer.from("dub!"));
    return completeJob(p.id, job.id, { video: { duration: 7, scriptVersion: queued.scriptVersion, ownVoice: true, dubVersion: voice!.dubVersion, ...video } });
  };
  // сборка без своих окон: окна и их версия — прежние, записи переехали и подходят
  const first = await dub({});
  assert.deepEqual(first.video!.lines, sound);
  assert.equal(first.video!.linesVersion, LINES_VERSION);
  assert.equal(first.dub!.takes[k0].videoAt, first.video!.at);
  assert.deepEqual(voiceOverProgress(first).missing, []);

  // сборка измерила окна заново, в допуске: записи переезжают и привязываются к новым окнам, место на ролике то же
  const k2Start = first.dub!.takes[k2].videoStart;
  await saveDubTake(p.id, k0, wav(3), metaFor(first, 0));
  const nudged = sound.map((w) => ({ ...w, start: Math.round((w.start + 0.01) * 1000) / 1000, end: Math.round((w.end + 0.02) * 1000) / 1000 }));
  const second = await dub({ lines: nudged, linesVersion: LINES_VERSION });
  assert.deepEqual(second.video!.lines, nudged);
  const t2 = second.dub!.takes[k2];
  assert.equal(t2.videoAt, second.video!.at);
  assert.deepEqual([t2.lineStart, t2.lineEnd, t2.videoStart], [4.31, 6.02, k2Start]);
  assert.deepEqual(
    voiceOverLines(second).map((l) => l.status),
    ["recorded", null, "recorded"],
  );

  // окно сдвинулось больше допуска — запись по нему устарела, а другая переехала
  await saveDubTake(p.id, k0, wav(3), metaFor(second, 0));
  const moved = nudged.map((w) => (w.index === 2 ? { ...w, start: 4.1 } : w));
  const third = await dub({ lines: moved, linesVersion: LINES_VERSION });
  assert.deepEqual(
    voiceOverLines(third).map((l) => l.status),
    ["recorded", null, "stale"],
  );
  assert.equal(retimed(voiceOverLines(third)[2], third.video), false, "запись осталась при прошлом ролике");
});

test("дубль поверх ролика: отметки проверяются, окно берётся из разметки", async () => {
  freshRoot();
  const p = await scripted("Дубль поверх ролика");
  const [k0, k2] = myKeys();
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor({ ...p, video: { file: "", at: "x", duration: 7, scriptVersion: 1, lines: windows } }, 0)), 409, /Ролик изменился/);
  const v = await montaged(p.id, windows);

  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(v, 0, { videoAt: "2020-01-01T00:00:00.000Z" })), 409, /Ролик изменился — обновите страницу/);
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(v, 0, { videoAt: undefined })), 400, /отметка ролика/);
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(v, 0, { videoStart: "сразу" })), 400, /числами/);
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(v, 0, { lineEnd: "" })), 400, /числами/);
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(v, 0, { latencyMs: 2500 })), 400, /Задержка/);
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(v, 0, { lineStart: 3, lineEnd: 2 })), 400, /Окно реплики/);
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(v, 0, { videoStart: 9 })), 400, /не попадает/);
  // окно не той реплики и окно, сдвинутое больше допуска
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(v, 2)), 409, /не совпадает с разметкой/);
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(v, 0, { lineStart: 0.3 })), 409, /не совпадает с разметкой/);
  // запись кончилась раньше, чем началась реплика
  await rejects(saveDubTake(p.id, k2, wav(0.4), metaFor(v, 2)), 400, /раньше, чем началась/);
  assert.deepEqual(getProject(p.id)!.dub, { version: 0, takes: {} });
  assert.deepEqual(tmpLeftovers(), []);

  // в допуске 0,05 с: хранится окно из разметки, а не присланное
  const saved = await saveDubTake(p.id, k0, wav(3), metaFor(v, 0, { lineStart: 0.23, lineEnd: 2.38, videoStart: "-0.0412" }));
  const t = saved.dub!.takes[k0];
  assert.equal(t.videoStart, -0.041);
  assert.equal(t.latencyMs, 40);
  assert.equal(t.lineStart, 0.2);
  assert.equal(t.lineEnd, 2.4);
  assert.equal(t.videoAt, v.video!.at);
  assert.deepEqual(
    voiceOverLines(saved).map((l) => l.status),
    ["recorded", null, "missing"],
  );
  assert.deepEqual(voiceOverProgress(saved), { total: 2, recorded: 1, missing: [2], problem: "не озвучена реплика 3" });
  assert.equal(toSummary(saved).dubbed, 1);

  // запись без ролика (старый путь «Мой голос») по-прежнему принимается, но поверх ролика не считается
  const plain = await saveDubTake(p.id, k2, wav(1));
  assert.equal(plain.dub!.takes[k2].videoAt, undefined);
  assert.equal(voiceOverLines(plain)[2].status, "stale");

  // сценарий изменён после монтажа: поверх старого ролика не пишем
  await patchProject(p.id, { script: { ...dialog, lines: [dialog.lines[0], { who: "claude", text: "Сколько-сколько?" }, dialog.lines[2]] } });
  const edited = getProject(p.id)!;
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(edited, 0)), 409, /Сценарий изменён после монтажа/);
  assert.equal(voiceOverProgress(edited).problem, "сценарий изменён после монтажа — сначала пересоберите ролик");
  assert.equal(voiceOverLines(edited)[0].status, "stale", "окна старого ролика к новому сценарию не применяются");
});

test("разметка по буквам: запись и сборка ждут уточнения, во время него записи закрыты, после неудачного — можно", async () => {
  freshRoot();
  const p = await scripted("Ждём разметку");
  const [k0, k2] = myKeys();
  const v = await montaged(p.id, windows, 7, {});
  assert.equal(letterWindows(v), true);
  assert.equal(needsRefine(v), true);
  const problem = "реплики размечены по буквам — сначала уточните разметку на странице озвучки";
  assert.equal(voiceOverProgress(v).problem, problem);
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(v, 0)), 409, /размечены по буквам — сначала уточните разметку/);
  assert.deepEqual(getProject(p.id)!.dub ?? { version: 0, takes: {} }, { version: 0, takes: {} });
  // запись без ролика (старый путь «Мой голос») разметки не касается
  assert.ok((await saveDubTake(p.id, k2, wav(1))).dub!.takes[k2]);

  // уточнение идёт: дубль, записанный сейчас, был бы по старым окнам
  await enqueue(p.id, "voice");
  const { job } = (await claimNext())!;
  const running = getProject(p.id)!;
  assert.equal(remeasuring(running), true);
  assert.equal(needsRefine(running), true);
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(v, 0)), 409, /Уточняем разметку реплик — записывать можно после неё/);

  // окон по звуку исполнитель не нашёл (монтажа нет в папке, нет таймингов озвучки или задача упала): по буквам можно
  const failed = await completeJob(p.id, job.id, {});
  assert.equal(failed.job?.state, "error", "подсказки без реплик — ошибка, но попытка разметки была");
  assert.equal(refineTried(failed), true);
  assert.equal(remeasuring(failed), false);
  assert.equal(needsRefine(failed), false);
  assert.equal(voiceOverProgress(failed).problem, "не озвучены реплики 1 и 3");
  await saveDubTake(p.id, k0, wav(3), metaFor(v, 0));
  const ready = await saveDubTake(p.id, k2, wav(3), metaFor(v, 2));
  assert.equal(voiceOverProgress(ready).problem, null);

  // сборка оставила окна по буквам: следующая правка снова ждёт попытки уточнить их
  const queued = await enqueue(p.id, "dub");
  const claimed = (await claimNext())!;
  await receiveVideoChunk(p.id, claimed.job.id, 0, 4, Buffer.from("dub!"));
  const dubbed = await completeJob(p.id, claimed.job.id, { video: { duration: 7, scriptVersion: queued.scriptVersion, ownVoice: true, dubVersion: claimed.voice!.dubVersion } });
  assert.deepEqual(dubbed.video!.lines, windows);
  assert.equal(needsRefine(dubbed), true);
  assert.equal(voiceOverProgress(dubbed).problem, problem);
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(dubbed, 0)), 409, /сначала уточните разметку/);
  await rejects(enqueue(p.id, "dub"), 400, /Собрать с твоим голосом нельзя: реплики размечены по буквам/);

  // окна по звуку — ждать нечего; после правки сценария окон нет вовсе, и дело уже не в разметке
  const q = await scripted("Разметка по звуку сразу");
  const sv = await montaged(q.id, sound);
  assert.equal(letterWindows(sv), false);
  assert.equal(needsRefine(sv), false);
  const edited = await patchProject(p.id, { script: { ...dialog, lines: [dialog.lines[0], { who: "claude", text: "Сколько-сколько?" }, dialog.lines[2]] } });
  assert.equal(letterWindows(edited), false);
  assert.equal(voiceOverProgress(edited).problem, "сценарий изменён после монтажа — сначала пересоберите ролик");
});

test("дубль поверх ролика — только целиком: обрыв посреди реплики не принимается", async () => {
  freshRoot();
  const p = await scripted("Реплика целиком");
  const [k0, k2] = myKeys();
  const v = await montaged(p.id, windows);
  // реплика 3 — 4,3–6 с; запись с 3,76 с остановлена на 5,3 с (на часах страницы)
  await rejects(saveDubTake(p.id, k2, wav(1.5), metaFor(v, 2)), 400, /обрывается до конца реплики/);
  assert.deepEqual(getProject(p.id)!.dub ?? { version: 0, takes: {} }, { version: 0, takes: {} });
  assert.deepEqual(tmpLeftovers(), []);
  // на пару кадров короче — не обрыв: старт записи и длина файла чуть расходятся
  assert.equal((await saveDubTake(p.id, k2, wav(2.1), metaFor(v, 2))).dub!.takes[k2].lineEnd, 6);
  // задержка записи сдвигает дубль на ролике, но до конца реплики он дошёл: на часах страницы −0,3 + 2,6 = 2,3 с
  const shifted = await saveDubTake(p.id, k0, wav(2.6), metaFor(v, 0, { latencyMs: 400, videoStart: -0.7 }));
  assert.equal(shifted.dub!.takes[k0].videoStart, -0.7);

  // ролик кончается раньше окна последней реплики: дубль, дошедший до конца ролика, целый
  const q = await scripted("Реплика до конца ролика");
  const short = await montaged(q.id, windows, 5.9);
  await saveDubTake(q.id, k2, wav(1.95), metaFor(short, 2));
  await rejects(saveDubTake(q.id, k2, wav(1.8), metaFor(short, 2)), 400, /обрывается/);
});

test("сборка с моим голосом: проверка перед очередью, план для раннера, новый ролик", async () => {
  freshRoot();
  const p = await scripted("Сборка с голосом");
  const [k0, k2] = myKeys();
  await rejects(enqueue(p.id, "dub"), 400, /Собрать с твоим голосом нельзя: сначала нужен ролик/);
  await montaged(p.id);
  await rejects(enqueue(p.id, "dub"), 400, /нет разметки/);
  const v = await montaged(p.id, windows);
  await rejects(enqueue(p.id, "dub"), 400, /не озвучены реплики 1 и 3/);
  await saveDubTake(p.id, k0, wav(3), metaFor(v, 0));
  // запись без отметок не годится для сборки
  await saveDubTake(p.id, k2, wav(1.5));
  await rejects(enqueue(p.id, "dub"), 400, /не озвучена реплика 3/);
  const ready = await saveDubTake(p.id, k2, wav(4), metaFor(v, 2));
  assert.equal(voiceOverProgress(ready).problem, null);

  const queued = await enqueue(p.id, "dub");
  assert.equal(queued.job?.task, "dub");
  assert.equal(statusOf(toSummary(queued)).text, "В очереди");
  await rejects(saveDubTake(p.id, k0, wav(3), metaFor(v, 0)), 409, /Идёт сборка с твоим голосом/);
  await rejects(removeDubTake(p.id, k0), 409, /Идёт сборка/);
  await rejects(enqueue(p.id, "montage"), 409);

  const claimed = (await claimNext())!;
  assert.equal(claimed.job.task, "dub");
  assert.equal(statusOf(toSummary(getProject(p.id)!)).text, "Собираем с твоим голосом");
  const plan = claimed.voice!;
  assert.equal(plan.ownVoice, true);
  assert.equal(plan.dubVersion, ready.dub!.version);
  assert.deepEqual(plan.keys, dialog.lines.map((l) => lineKey(l.text)));
  const t0 = ready.dub!.takes[k0];
  const t2 = ready.dub!.takes[k2];
  assert.deepEqual(plan.lines, [
    { index: 0, key: k0, take: t0.take, bytes: t0.bytes, sha256: t0.sha256, text: dialog.lines[0].text, videoStart: t0.videoStart, lineStart: 0.2, lineEnd: 2.4 },
    { index: 2, key: k2, take: t2.take, bytes: t2.bytes, sha256: t2.sha256, text: dialog.lines[2].text, videoStart: t2.videoStart, lineStart: 4.3, lineEnd: 6 },
  ]);
  // раннер сборки скачивает записи и заливает ролик так же, как монтаж
  assert.equal(runnerDubTake(p.id, claimed.job.id, k2, t2.take).sha256, t2.sha256);
  assert.deepEqual(await receiveVideoChunk(p.id, claimed.job.id, 0, 5, Buffer.from("dub!!")), { done: true, size: 5 });

  // без своей разметки сборка оставляет окна прежнего ролика: сцена и склейки те же
  const done = await completeJob(p.id, claimed.job.id, { video: { duration: 7.05, scriptVersion: 1, ownVoice: true, dubVersion: plan.dubVersion } });
  assert.equal(done.job?.state, "done");
  assert.notEqual(done.video!.at, v.video!.at);
  assert.equal(done.video!.ownVoice, true);
  assert.equal(done.video!.dubVersion, plan.dubVersion);
  assert.deepEqual(done.video!.lines, windows);
  // записи переехали на новый ролик: переписать одну реплику — не значит переписывать все
  assert.equal(done.dub!.takes[k0].videoAt, done.video!.at);
  assert.deepEqual(voiceOverProgress(done), {
    total: 2,
    recorded: 2,
    missing: [],
    problem: "ролик уже собран с этими записями — перезапиши реплику, чтобы собрать заново",
  });
  // the same takes cannot be sent again: only a new take opens «Собрать с моим голосом»
  await rejects(enqueue(p.id, "dub"), 400, /уже собран с этими записями/);
  assert.equal(statusOf(toSummary(done)).text, "Готово");
  assert.equal(toSummary(done).dubbed, 2);

  // новый монтаж двигает реплики: записи поверх старого ролика устаревают
  const remade = await montaged(p.id, windows);
  assert.deepEqual(
    voiceOverLines(remade).map((l) => l.status),
    ["stale", null, "stale"],
  );
  await rejects(enqueue(p.id, "dub"), 400, /не озвучены реплики 1 и 3/);
});

test("сборка: запись сменили руками до взятия — задача с ошибкой; сборка с ошибкой не трогает ролик", async () => {
  freshRoot();
  const p = await scripted("Сборка и правка руками");
  const v = await montaged(p.id, windows);
  for (const [i, key] of myKeys().entries()) await saveDubTake(p.id, key, wav(4), metaFor(v, i * 2));
  await enqueue(p.id, "dub");
  const file = path.join(projectDir(p.id), "project.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Project3D;
  delete raw.dub!.takes[myKeys()[1]].videoAt;
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal(await claimNext(), null);
  const failed = getProject(p.id)!;
  assert.equal(failed.job?.state, "error");
  assert.match(failed.job?.error ?? "", /озвучены поверх этого ролика/);

  const p2 = await scripted("Сборка с ошибкой");
  const v2 = await montaged(p2.id, windows);
  for (const [i, key] of myKeys().entries()) await saveDubTake(p2.id, key, wav(4), metaFor(v2, i * 2));
  await enqueue(p2.id, "dub");
  const { job } = (await claimNext())!;
  const err = await completeJob(p2.id, job.id, { error: "Видеокарта занята" });
  assert.equal(err.job?.state, "error");
  assert.equal(err.video?.at, v2.video!.at);
  assert.equal(voiceOverProgress(err).recorded, 2, "записи остаются при старом ролике");
});

test("монтаж после озвучки: предупреждение, записи поверх ролика не идут в старый «Мой голос»", async () => {
  freshRoot();
  const p = await scripted("Монтаж после озвучки");
  const [k0, k2] = myKeys();
  assert.equal(montageWarning(p), null, "без ролика терять нечего");
  const v = await montaged(p.id, windows);
  assert.equal(montageWarning(v), null, "ролик с синтезом, записей поверх него нет");

  // реплика в самом начале ролика: разгон идёт на первом кадре, и дубль начинается раньше видео
  const lead = await saveDubTake(p.id, k0, wav(3), metaFor(v, 0, { videoStart: -0.35 }));
  assert.equal(lead.dub!.takes[k0].videoStart, -0.35);
  await rejects(saveDubTake(p.id, k0, wav(4.5), metaFor(v, 0, { videoStart: -5.5 })), 400, /не попадает в ролик/);
  assert.match(montageWarning(lead) ?? "", /записанное поверх этого ролика \(1\)/);

  // старый «Мой голос» берёт запись целиком, а в дубле поверх ролика — подсказка Клода из динамиков
  await saveDubTake(p.id, k2, wav(1));
  const on = await patchProject(p.id, { ownVoice: true });
  assert.deepEqual(overVideoLines(on.script, on.dub), [0]);
  await rejects(enqueue(p.id, "montage"), 400, /реплика 1 записана поверх ролика.*«Собрать с моим голосом»/);

  // такую запись подложили руками после постановки в очередь — задача с ошибкой, раннер её не получает
  await saveDubTake(p.id, k0, wav(1));
  await enqueue(p.id, "montage");
  const file = path.join(projectDir(p.id), "project.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Project3D;
  raw.dub!.takes[k2].videoAt = v.video!.at;
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal(await claimNext(), null);
  assert.equal(getProject(p.id)!.job?.state, "error");
  assert.match(getProject(p.id)!.job?.error ?? "", /реплика 3 записана поверх ролика/);

  // ролик собран с голосом владельца: новый монтаж заменит его синтезом
  const q = await scripted("Собранный ролик");
  const qv = await montaged(q.id, windows);
  for (const [i, key] of myKeys().entries()) await saveDubTake(q.id, key, wav(4), metaFor(qv, i * 2));
  assert.match(montageWarning(getProject(q.id)!) ?? "", /\(2\)/);
  await enqueue(q.id, "dub");
  const { job } = (await claimNext())!;
  await receiveVideoChunk(q.id, job.id, 0, 4, Buffer.from("dub!"));
  const dubbed = await completeJob(q.id, job.id, { video: { duration: 7, scriptVersion: 1, ownVoice: true, dubVersion: 2 } });
  assert.match(montageWarning(dubbed) ?? "", /Ролик с твоим голосом заменится новым/);
  // со старым переключателем монтаж снова возьмёт его записи: голос не теряется
  assert.equal(montageWarning({ ...dubbed, ownVoice: true, dub: { version: 0, takes: {} } }), null);
});

test("окно озвучки: только своя реплика — полсекунды до, чуть после; у реплики в начале ролика разгон на первом кадре", () => {
  // реплика с нуля (как первая реплика настоящего ролика, 0–2,56 с): полсекунды разгона — на первом кадре
  assert.equal(DUB_PRE_ROLL, 0.5);
  assert.deepEqual(dubSpan({ start: 0, end: 2.56 }, 30), { from: -0.5, play: 0, lead: 0.5, to: 2.96 });
  const early = dubSpan({ start: 0.3, end: 2 }, 30);
  assert.equal(early.play, 0);
  assert.ok(Math.abs(early.lead - 0.2) < 1e-9);
  assert.ok(Math.abs(early.to - 2.4) < 1e-9);
  // реплика Клода перед твоей (как «В смысле ноль?!» после его слов) в окно не попадает: только полсекунды до твоей
  assert.deepEqual(dubSpan({ start: 5, end: 7 }, 30), { from: 4.5, play: 4.5, lead: 0, to: 7.4 });
  assert.equal(dubSpan({ start: 28, end: 29.8 }, 30).to, 30, "завершение не выходит за конец ролика");

  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(median([])));
  const steady = Array.from({ length: 150 }, (_, i) => -2.08 + (i % 3) * 0.004 + (i === 0 ? 0.066 : 0));
  assert.ok(takeSlip(steady) < 0.045, "дрожание кадров и поздний первый кадр — не сбой");
  // ролик подгружался 0,4 с, пока шла запись: поздние кадры оценивают начало дубля на 0,4 с раньше
  const stalled = steady.map((e, i) => (i >= 90 ? e - 0.4 : e));
  assert.ok(Math.abs(takeSlip(stalled) - 0.4) < 0.01);
  // занятый браузер показывает кадр в секунду: сбой виден и по четырём кадрам
  assert.ok(Math.abs(takeSlip([3.243, 3.243, 2.843, 2.843]) - 0.4) < 1e-9);
  assert.equal(takeSlip([3.243, 2.843, 2.843]), 0, "по одному кадру с краю не судим");
  assert.equal(takeSlip([]), 0);
});

test("одни и те же слова дважды: одна запись на обе реплики, на втором месте — со сдвигом", () => {
  const script: Script3D = {
    title: "Повтор",
    lines: [
      { who: "me", text: "Что?" },
      { who: "claude", text: "Биткоин упал." },
      { who: "me", text: "Что?!" },
      { who: "me", text: "[laughs]" },
    ],
  };
  const video = {
    file: "out.mp4",
    at: "2026-10-22T10:00:00.000Z",
    duration: 9,
    scriptVersion: 3,
    linesVersion: LINES_VERSION,
    lines: [
      { index: 0, who: "me" as const, start: 0.5, end: 1 },
      { index: 1, who: "claude" as const, start: 1.2, end: 3 },
      { index: 2, who: "me" as const, start: 5, end: 5.6 },
      { index: 3, who: "me" as const, start: 6, end: 7 },
    ],
  };
  const take: DubTake = {
    key: lineKey("Что?"),
    take: 1,
    text: "Что?",
    file: "dub/x.1.flac",
    bytes: 10,
    sha256: "a".repeat(64),
    duration: 2.5,
    peakDb: -3,
    at: "",
    scriptVersion: 3,
    videoStart: 0.2,
    latencyMs: 0,
    lineStart: 0.5,
    lineEnd: 1,
    videoAt: video.at,
  };
  const src = { script, scriptVersion: 3, dub: { version: 1, takes: { [take.key]: take } }, video };
  assert.deepEqual(
    voiceOverLines(src).map((l) => l.status),
    ["recorded", null, "recorded", "optional"],
  );
  assert.deepEqual(placeTake(take, video.lines[2]), { videoStart: 4.7, lineStart: 5, lineEnd: 5.6 });
  assert.deepEqual(voiceOverProgress(src), { total: 2, recorded: 2, missing: [], problem: null });
  // ролик, чья реплика говорит не тот герой, её не размечает
  const swapped = { ...src, video: { ...video, lines: video.lines.map((l) => (l.index === 1 ? { ...l, who: "me" as const } : l)) } };
  assert.equal(videoWindows(swapped).has(1), false);
});
