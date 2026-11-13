import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALARM_WORDS,
  checkStory,
  storyNote,
  TELEGRAM_LINE,
  trialCalmTitle,
  withTelegram,
  checkTracks,
  formatDuration,
  isLive,
  isLost,
  jobActive,
  MAX_TRACKS,
  musicLabel,
  projectTitle,
  RUNNER_QUIET_MS,
  runnerQuiet,
  shownTitle,
  statusOf,
  STORY_SOURCES_MAX,
  STORY_TITLE_MAX,
  toSummary,
  toView,
  trackLabel,
  type JobView,
} from "../lib/news/rules";
import { mirrorOf, MIRROR_MARK, projectLinks, relinkNews } from "../lib/news/links";
import { STALE_MS, type NewsJob, type NewsProject } from "../lib/news/types";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const iso = (ms: number) => new Date(NOW - ms).toISOString();

const job = (over: Partial<NewsJob> = {}): NewsJob => ({ id: "job-000001", task: "create", state: "running", step: "Монтируем", progress: 40, createdAt: iso(60_000), startedAt: iso(50_000), heartbeatAt: iso(1000), ...over });
const view = (over: Partial<NewsJob> = {}): JobView => ({ ...job(over), lost: isLost(job(over), NOW) });
const VIDEO = { file: "out.mp4", at: iso(0), duration: 42, music: null };

test("плашка статуса: очередь, поиск истории, монтаж, перемонтаж, ошибка, пропавший ПК, готово", () => {
  const chip = (j: JobView | null, video: typeof VIDEO | null = null, title: string | null = null) => statusOf({ job: j, video, title });
  assert.deepEqual(chip(view({ state: "queued" })), { text: "В очереди", tone: "neutral", busy: true });
  assert.deepEqual(chip(view({ state: "queued", task: "rerender" }), VIDEO, "x"), { text: "Перемонтаж в очереди", tone: "neutral", busy: true });
  assert.deepEqual(chip(view()), { text: "Ищем историю", tone: "accent", busy: true });
  assert.deepEqual(chip(view(), null, "Вазелин"), { text: "Делаем ролик · 40%", tone: "accent", busy: true });
  assert.deepEqual(chip(view({ task: "rerender", progress: 7 }), VIDEO, "Вазелин"), { text: "Перемонтируем · 7%", tone: "accent", busy: true });
  assert.deepEqual(chip(view({ state: "error", error: "x" })), { text: "Ошибка", tone: "error", busy: false });
  assert.deepEqual(chip(view({ state: "error", task: "rerender" }), VIDEO, "x"), { text: "Готово", tone: "success", busy: false }, "неудачный перемонтаж не портит готовый ролик");
  assert.deepEqual(chip(view({ heartbeatAt: iso(STALE_MS + 1000) })), { text: "ПК не отвечает", tone: "warn", busy: false });
  assert.deepEqual(chip(view({ state: "done" }), VIDEO, "x"), { text: "Готово", tone: "success", busy: false });
  assert.deepEqual(chip(null), { text: "Без ролика", tone: "neutral", busy: false });
});

test("живая и пропавшая задача по часам сервера", () => {
  assert.equal(isLost(job(), NOW), false);
  assert.equal(isLost(job({ heartbeatAt: iso(STALE_MS + 1) }), NOW), true);
  assert.equal(isLost(job({ heartbeatAt: undefined, startedAt: iso(STALE_MS + 1) }), NOW), true);
  assert.equal(isLost(job({ state: "queued", heartbeatAt: iso(STALE_MS * 3) }), NOW), false, "в очереди задача не теряется");
  assert.equal(isLive(job({ state: "queued" }), NOW), true);
  assert.equal(isLive(job({ heartbeatAt: iso(STALE_MS + 1) }), NOW), false);
  assert.equal(isLive(job({ state: "done" }), NOW), false);
  assert.equal(isLive(null, NOW), false);
  assert.equal(jobActive(view({ state: "queued" })), true);
  assert.equal(jobActive(view({ state: "error" })), false);
  assert.equal(jobActive(null), false);
});

test("заголовок на страницах: история, поиск, не найдена", () => {
  assert.equal(shownTitle("Вазелин", view()), "Вазелин");
  assert.equal(shownTitle(null, view({ state: "queued" })), "Ищем историю…");
  assert.equal(shownTitle(null, view()), "Ищем историю…");
  assert.equal(shownTitle(null, view({ state: "error" })), "История не найдена");
  assert.equal(shownTitle(null, view({ heartbeatAt: iso(STALE_MS + 1000) })), "История не найдена");
  assert.equal(shownTitle(null, null), "История не найдена");
  assert.equal(projectTitle({ story: null }), "Новости");
});

test("toView и toSummary: решение о пропаже — по часам сервера, метки — с сервера", () => {
  const p: NewsProject = {
    id: "abc123def",
    createdAt: iso(100_000),
    updatedAt: iso(1000),
    story: { title: "Вазелин", summary: "", hero: "@mindaylee_", sources: [], script: "текст" },
    job: job({ heartbeatAt: iso(STALE_MS + 5) }),
    video: VIDEO,
    meta: null,
    cover: null,
    mirrorId: null,
  };
  assert.equal(toView(p, NOW).job?.lost, true);
  const marks = { cover: { at: "c1" }, published: [{ platform: "tiktok" as const, state: "published" as const }] };
  const s = toSummary(p, NOW, marks);
  assert.deepEqual({ id: s.id, title: s.title, hero: s.hero, cover: s.cover, published: s.published, lost: s.job?.lost }, { id: p.id, title: "Вазелин", hero: "@mindaylee_", cover: { at: "c1" }, published: marks.published, lost: true });
  assert.equal(toSummary({ ...p, story: null }, NOW).title, null);
  // «Доработка»: отметка владельца доходит до списка, без неё поля нет
  assert.equal(toSummary({ ...p, rework: true }, NOW).rework, true);
  assert.equal("rework" in toSummary(p, NOW), false);
});

test("крипто-ролик: история несёт направление, подпись — одну строку про тг; остальные ролики тг не упоминают", () => {
  assert.equal(checkStory({ title: "t", script: "s", lane: "crypto-news" }).story?.lane, "crypto-news");
  assert.equal("lane" in checkStory({ title: "t", script: "s", lane: "world" }).story!, false, "не крипта — направление не хранится");
  const crypto = { title: "t", summary: "", sources: [], script: "s", lane: "crypto-fun" };
  assert.equal(withTelegram("Мораль.\nВопрос?", crypto), `Мораль.\nВопрос?\n\n${TELEGRAM_LINE}`);
  assert.equal(withTelegram("Мораль.", { ...crypto, lane: "crypto-news" }), `Мораль.\n\n${TELEGRAM_LINE}`, "у новостного — та же строка");
  assert.equal(withTelegram("Мораль.", { ...crypto, lane: undefined }), "Мораль.");
  assert.equal(withTelegram("Сделки — в тг.", crypto), "Сделки — в тг.", "уже упомянут — второй раз не добавляется");
  assert.equal(withTelegram("Отгрузка задержалась.", crypto).split("\n\n").length, 2, "«тг» внутри слова — не упоминание");
});

test("опыт на YouTube: вариант и своя фраза про телеграм хранятся у крипто-ролика, подпись им следует", () => {
  const raw = { title: "t", script: "s", lane: "crypto-news", trial: "calm", telegram: "  Биржу взломали, а золото не взломаешь. Сделки — в телеграме,  ссылка в шапке профиля. " };
  const story = checkStory(raw).story!;
  assert.equal(story.trial, "calm");
  assert.equal(story.telegram, "Биржу взломали, а золото не взломаешь. Сделки — в телеграме, ссылка в шапке профиля.");
  assert.equal(withTelegram("Мораль.", story), "Мораль.", "вариант без телеграма — строки в подписи нет");
  assert.equal(withTelegram("Мораль.", { ...story, trial: "no-tg" }), "Мораль.");
  assert.equal(withTelegram("Мораль.", { ...story, trial: "soft" }), `Мораль.\n\n${story.telegram}`, "фраза из ролика — она же строка подписи");
  assert.equal(withTelegram("Мораль.", { ...story, trial: "base", telegram: undefined }), `Мораль.\n\n${TELEGRAM_LINE}`, "своей фразы нет — общая строка владельца");
  assert.equal(trialCalmTitle(story), true);
  assert.equal(trialCalmTitle({ ...story, trial: "no-tg" }), false);
  assert.equal("trial" in checkStory({ ...raw, trial: "wild" }).story!, false, "чужое значение не хранится");
  assert.equal("trial" in checkStory({ ...raw, lane: "world" }).story!, false, "не крипта — варианта нет");
  assert.equal("telegram" in checkStory({ ...raw, telegram: "Просто фраза без канала." }).story!, false, "фраза не про телеграм — не строка подписи");
  assert.equal(ALARM_WORDS.test("Взлом Binance: хакерам пишут"), true);
  assert.equal(ALARM_WORDS.test("Binance: клиентам пишут «Выручи, братан»"), false);
});

test("второй запуск: пометка хранится и видна в списке; у обычного крипто-ролика в списке вариант опыта", () => {
  const relaunch = checkStory({ title: "Очки Шакиры", script: "s", relaunch: { of: "mvxpq8it18a0083569", platform: "instagram" } }).story!;
  assert.deepEqual(relaunch.relaunch, { of: "mvxpq8it18a0083569", platform: "instagram" });
  assert.equal(storyNote(relaunch), "Новое начало · для Instagram");
  assert.equal("relaunch" in checkStory({ title: "t", script: "s", relaunch: { of: "../x", platform: "instagram" } }).story!, false);
  assert.equal("relaunch" in checkStory({ title: "t", script: "s", relaunch: { of: "mvxpq8it18a0083569", platform: "vk" } }).story!, false);
  assert.equal(storyNote({ title: "t", summary: "", sources: [], script: "s", lane: "crypto-fun", trial: "no-tg" }), "Опыт YouTube: без телеграма");
  assert.equal(storyNote({ title: "t", summary: "", sources: [], script: "s", lane: "crypto-fun", trial: "base" }), undefined);
  assert.equal(storyNote({ title: "t", summary: "", sources: [], script: "s" }), undefined);
});

test("checkStory: чистит пробелы, ссылки только http(s), проблемы списком", () => {
  const ok = checkStory({
    title: "  Кореянка   переименовала Vaseline ",
    summary: " Два \n предложения. ",
    hero: "  @mindaylee_ (TikTok) ",
    sources: [{ url: " https://www.tiktok.com/@mindaylee_/video/1 ", note: "  ролик " }, { url: "http://example.com/a" }],
    script: "  Первая строка.  \r\n\r\n\r\n\r\nВторая строка.  ",
  });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.story, {
    title: "Кореянка переименовала Vaseline",
    summary: "Два предложения.",
    hero: "@mindaylee_ (TikTok)",
    sources: [{ url: "https://www.tiktok.com/@mindaylee_/video/1", note: "ролик" }, { url: "http://example.com/a" }],
    script: "Первая строка.\n\nВторая строка.",
  });
  assert.equal("hero" in checkStory({ title: "t", script: "s" }).story!, false, "пустой герой не хранится");
  assert.deepEqual(checkStory({ title: "t", script: "s" }).story?.sources, []);

  const bad = checkStory({
    title: "x".repeat(STORY_TITLE_MAX + 1),
    summary: 5,
    sources: [{ url: "javascript:alert(1)" }, { url: "file:///etc/passwd" }, { url: "https://ok.example", note: 3 }],
    script: "",
  });
  assert.equal(bad.story, null);
  assert.equal(bad.problems.length, 6, bad.problems.join(" | "));
  assert.match(bad.problems.join(" | "), /Заголовок истории длиннее/);
  assert.match(bad.problems.join(" | "), /Источник 1: нужна ссылка http\(s\)/);
  assert.match(bad.problems.join(" | "), /Источник 2: нужна ссылка/);
  assert.match(bad.problems.join(" | "), /Источник 3: пометка должна быть строкой/);
  assert.match(bad.problems.join(" | "), /нет текста озвучки/);
  const many = checkStory({ title: "t", script: "s", sources: Array.from({ length: STORY_SOURCES_MAX + 1 }, (_, i) => ({ url: `https://e.example/${i}` })) });
  assert.match(many.problems.join(), /Источников больше/);
  assert.deepEqual(checkStory(null).problems, ["История не распознана"]);
  assert.deepEqual(checkStory([1]).problems, ["История не распознана"]);
});

test("checkTracks: битые записи отброшены, повторы — первая, без названия — имя файла", () => {
  const { tracks, dropped } = checkTracks([
    { file: "VØJ, Narvent — Memory Reboot.m4a", title: "  Memory   Reboot ", duration: 182.44 },
    { file: "calm.mp3", duration: 95 },
    { file: "calm.mp3", title: "дубль", duration: 10 },
    { file: "../up.mp3", duration: 10 },
    { file: "dir\\x.mp3", duration: 10 },
    { file: "long.mp3", duration: 4000 },
    { file: "", duration: 10 },
    "строка",
  ]);
  assert.deepEqual(tracks, [
    { file: "VØJ, Narvent — Memory Reboot.m4a", title: "Memory Reboot", duration: 182.4 },
    { file: "calm.mp3", title: "calm", duration: 95 },
  ]);
  assert.equal(dropped, 6);
  assert.deepEqual(checkTracks("calm.mp3"), { tracks: [], dropped: 0 });
  const huge = checkTracks(Array.from({ length: MAX_TRACKS + 5 }, (_, i) => ({ file: `${i}.mp3`, duration: 1 })));
  assert.equal(huge.tracks.length, MAX_TRACKS);
  assert.equal(huge.dropped, 5);
});

test("подписи музыки: длительность, трек, без музыки, трек, которого нет на ПК", () => {
  const tracks = [{ file: "calm.mp3", title: "Calm", duration: 125.4 }];
  assert.equal(formatDuration(125.4), "2:05");
  assert.equal(formatDuration(59.6), "1:00");
  assert.equal(formatDuration(NaN), "0:00");
  assert.equal(trackLabel(tracks[0]), "Calm · 2:05");
  assert.equal(musicLabel("calm.mp3", tracks), "Calm");
  assert.equal(musicLabel(null, tracks), "без музыки");
  assert.equal(musicLabel("gone.m4a", tracks), "gone", "трек убрали с ПК — имя файла без расширения");
});

test("ПК не забирает задачи: только когда задача давно ждёт, никто не работает и ПК молчит", () => {
  const waiting = job({ state: "queued", createdAt: iso(RUNNER_QUIET_MS + 1000) });
  const fresh = job({ state: "queued", createdAt: iso(5000) });
  assert.equal(runnerQuiet([waiting], null, NOW), true, "после перезапуска сайта ПК ни разу не спрашивал");
  assert.equal(runnerQuiet([waiting], iso(RUNNER_QUIET_MS + 1000), NOW), true);
  assert.equal(runnerQuiet([waiting], iso(10_000), NOW), false, "ПК спрашивал недавно");
  assert.equal(runnerQuiet([fresh], null, NOW), false, "задача только что поставлена");
  assert.equal(runnerQuiet([waiting, job()], null, NOW), false, "ПК занят другой задачей — новых не спрашивает");
  assert.equal(runnerQuiet([waiting, job({ heartbeatAt: iso(STALE_MS + 1000) })], null, NOW), true, "пропавшая задача — не занятость");
  assert.equal(runnerQuiet([null, job({ state: "done" })], null, NOW), false);
});

test("зеркала «Новостей»: метка, ссылки страницы публикаций поверх ссылок «3Д»", () => {
  assert.equal(MIRROR_MARK, "newsId");
  assert.equal(mirrorOf({ id: "m1", newsId: "abc123def" }), "abc123def");
  assert.equal(mirrorOf({ id: "m1", newsId: "" }), null);
  assert.equal(mirrorOf({ id: "m1", studio3dId: "x" }), null);
  assert.equal(mirrorOf(null), null);

  const projects = [{ id: "m1", newsId: "abc123def" }, { id: "m2", studio3dId: "s3d0001" }, { id: "m3" }];
  const plain = projectLinks(projects);
  assert.equal(plain("m1"), "/news/abc123def");
  assert.equal(plain("m3"), "/project/m3");
  const over3d = projectLinks(projects, (id) => (id === "m2" ? "/3d/s3d0001" : `/project/${id}`));
  assert.equal(over3d("m2"), "/3d/s3d0001");
  assert.equal(over3d("m1"), "/news/abc123def");

  const entries = [
    { id: "a", href: "/project/m1" },
    { id: "b", href: "/3d/s3d0001" },
    { id: "c", href: "/project/m3" },
    { id: "d", href: "/carousel/c1" },
  ];
  assert.deepEqual(
    relinkNews(entries, projects).map((e) => e.href),
    ["/news/abc123def", "/3d/s3d0001", "/project/m3", "/carousel/c1"],
  );
  assert.equal(entries[0].href, "/project/m1", "исходный список не меняется");
});
