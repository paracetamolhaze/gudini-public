import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyHook, HOOKS } from "../lib/trends/hooks";
import { accountMedian, confidence, median, outliersOf, parseCount, pickOutliers, runSummary } from "../lib/trends/rank";
import { cleanHandle, followersFromJson, followersFromOg, mediaFromJson, mergeReels, netscapeCookies, shortsFromPlaylist, spokenHook, tileViews, wordsFromJson3 } from "../lib/trends/parse";
import { ideaUser, normalizeAnalysis, normalizeVideo, rhythmBlock, sketchIssues, VIDEO_SAMPLE, videoIssues } from "../lib/trends/prompts";
import { timedTranscript } from "../lib/trends/media";
import { findCuts, RHYTHM_HEIGHT, RHYTHM_WIDTH, rhythmOf } from "../lib/trends/rhythm";
import { ideaKindOf, type AccountRead, type ReelStat, type TrendCard } from "../lib/trends/types";

const reels = (views: number[], extra: Partial<ReelStat> = {}): ReelStat[] =>
  views.map((v, i) => ({ key: `instagram:code${i}xx`, code: `code${i}xx`, url: `https://www.instagram.com/reel/code${i}xx/`, views: v, ...extra }));
const read = (handle: string, views: number[]): AccountRead => {
  const r = reels(views).map((x) => ({ ...x, key: `instagram:${handle}${x.code}`, code: `${handle}${x.code}` }));
  return { accountId: handle, source: "instagram", handle, followers: 1000, median: accountMedian(r), reels: r, at: "" };
};

test("счётчики Instagram и YouTube: 1.2M, 980K, 12,345, «1,5 тыс.»", () => {
  assert.equal(parseCount("1.2M"), 1_200_000);
  assert.equal(parseCount("980K"), 980_000);
  assert.equal(parseCount("12,345"), 12_345);
  assert.equal(parseCount("1,234,567"), 1_234_567);
  assert.equal(parseCount("1,5 тыс."), 1500);
  assert.equal(parseCount("2,5 млн"), 2_500_000);
  assert.equal(parseCount("731"), 731);
  assert.equal(parseCount(4200), 4200);
  assert.equal(parseCount("нет"), null);
  assert.equal(tileViews("Pinned\n48.1K\n"), 48_100);
});

test("медиана: по последним роликам без закреплённых и нулей; меньше шести — не считаем", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([]), null);
  const list = [...reels([10_000, 12_000, 9_000, 11_000, 0, 13_000, 8_000]), ...reels([5_000_000], { pinned: true })];
  assert.equal(accountMedian(list), 10_500);
  assert.equal(accountMedian(reels([1, 2, 3, 4, 5])), null);
});

test("выброс — в 3 и больше раз выше медианы своего аккаунта; крупный аккаунт с обычным днём не попадает", () => {
  const small = read("small", [4000, 5000, 4500, 5200, 4800, 61_000, 3900]);
  const big = read("big", [400_000, 380_000, 420_000, 410_000, 390_000, 900_000, 405_000]);
  assert.equal(small.median, 4800);
  const o = outliersOf(small);
  assert.equal(o.length, 1);
  assert.equal(o[0].reel.views, 61_000);
  assert.ok(o[0].multiple > 12);
  assert.equal(outliersOf(big).length, 0, "900 тыс. при медиане 405 тыс. — ×2,2, это обычный хороший день");
});

test("в выдачу не больше трёх роликов одного аккаунта, сильнейшие первыми", () => {
  const hot = read("hot", [1000, 1000, 1000, 1000, 1000, 1000, 1000, 9000, 8000, 7000, 6000]);
  const calm = read("calm", [2000, 2100, 1900, 2000, 2050, 1950, 30_000]);
  const picked = pickOutliers([hot, calm]);
  assert.deepEqual(picked.map((p) => p.read.handle), ["calm", "hot", "hot", "hot"]);
  assert.deepEqual(picked.filter((p) => p.read.handle === "hot").map((p) => p.reel.views), [9000, 8000, 7000]);
  // тот же автор на YouTube: предел три ролика на автора на обеих площадках вместе
  const hotYoutube = { ...read("hotyt", [100, 100, 100, 100, 100, 100, 5000]), accountId: "hot", source: "youtube" as const };
  const both = pickOutliers([hot, hotYoutube]);
  assert.equal(both.length, 3);
  assert.deepEqual(both.map((p) => Math.round(p.multiple)), [50, 9, 8]);
});

test("формулы зацепки размечаются по шаблонам hooks.json", () => {
  assert.equal(HOOKS.length, 26);
  assert.deepEqual(HOOKS.map((h) => h.id), Array.from({ length: 26 }, (_, i) => i + 1));
  const id = (s: string) => classifyHook(s)?.id ?? null;
  assert.equal(id("$18,000 is what one missing clause cost me."), 1);
  assert.equal(id("Nobody tells you that your first 30 reels are supposed to flop."), 3);
  assert.equal(id("Proposals used to take me five hours."), 5);
  assert.equal(id("Watch what happens when I paste a competitor's caption into this."), 18);
  assert.equal(id("Carousels versus reels."), 17);
  assert.equal(id("You don't need a niche."), 20);
  assert.equal(id("33% of high school graduates never read another book."), 23);
  assert.equal(id("My cat learned to open the fridge"), null);
});

test("ролики профиля из JSON страницы: числа, длительность, подпись, закреплённые; без JSON — число с плитки", () => {
  const body = {
    data: {
      xdt_api__v1__clips__user__connection_v2: {
        edges: [
          { node: { media: { code: "AAA111", media_type: 2, play_count: 52_000, video_duration: 31.4, caption: { text: "Nobody tells you this" }, taken_at: 1_760_000_000, clips_tab_pinned_user_ids: [] } } },
          { node: { media: { code: "BBB222", product_type: "clips", play_count: 2_100_000, clips_tab_pinned_user_ids: ["1"] } } },
        ],
      },
      user: { username: "Someone", follower_count: 48_000 },
    },
  };
  const media = mediaFromJson(body);
  assert.equal(media.get("AAA111")?.views, 52_000);
  assert.equal(media.get("BBB222")?.pinned, true);
  assert.equal(followersFromJson(body, "someone"), 48_000);
  const tiles = [
    { href: "/someone/reel/BBB222/", text: "2.1M", pinned: true },
    { href: "/someone/reel/AAA111/", text: "52K", pinned: false },
    { href: "/someone/reel/CCC333/", text: "8,140", pinned: false },
    { href: "/someone/reel/AAA111/", text: "52K", pinned: false },
  ];
  const list = mergeReels(tiles, media);
  assert.deepEqual(list.map((r) => [r.code, r.views, Boolean(r.pinned)]), [["BBB222", 2_100_000, true], ["AAA111", 52_000, false], ["CCC333", 8140, false]]);
  assert.equal(list[1].duration, 31.4);
  assert.equal(list[1].caption, "Nobody tells you this");
  assert.equal(list[1].url, "https://www.instagram.com/reel/AAA111/");
  assert.equal(followersFromOg("1.2M Followers, 300 Following, 1,234 Posts - See Instagram photos"), 1_200_000);
  const reel = mediaFromJson({ items: [{ code: "AAA111", media_type: 2, video_versions: [
    { width: 1080, url: "https://scontent-a.cdninstagram.com/v/1080.mp4" },
    { width: 480, url: "https://scontent-a.cdninstagram.com/v/480.mp4" },
    { width: 320, url: "https://evil.example.com/320.mp4" },
  ] }] });
  assert.equal(reel.get("AAA111")?.videoUrl, "https://scontent-a.cdninstagram.com/v/480.mp4", "самый узкий не уже 480 px и только с CDN Instagram");
});

test("Shorts канала из yt-dlp и сказанная зацепка из автосубтитров", () => {
  const { followers, reels: list } = shortsFromPlaylist({ channel_follower_count: 91_000, entries: [{ id: "abcDEF12345", view_count: 120_000, title: "AI did this" }, { id: "bad id" }] });
  assert.equal(followers, 91_000);
  assert.deepEqual(list.map((r) => [r.key, r.views, r.url]), [["youtube:abcDEF12345", 120_000, "https://www.youtube.com/shorts/abcDEF12345"]]);
  const words = wordsFromJson3({ events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "Nobody" }, { utf8: " tells", tOffsetMs: 400 }, { utf8: " you", tOffsetMs: 800 }] },
    { tStartMs: 2000, segs: [{ utf8: "\n" }] },
    { tStartMs: 3200, dDurationMs: 1000, segs: [{ utf8: "this." }] },
  ] });
  assert.equal(spokenHook(words), "Nobody tells you");
  assert.equal(timedTranscript(words), "[0.0 с] Nobody tells you this.");
});

test("куки для yt-dlp в формате Netscape и ники из ссылок", () => {
  const text = netscapeCookies([{ name: "sessionid", value: "abc", domain: ".instagram.com", path: "/", expires: 1_900_000_000.5, secure: true }]);
  assert.equal(text, "# Netscape HTTP Cookie File\n.instagram.com\tTRUE\t/\tTRUE\t1900000000\tsessionid\tabc\n");
  assert.equal(cleanHandle(" @Mr.Eflow "), "Mr.Eflow");
  assert.equal(cleanHandle("https://www.instagram.com/alberta.tech/"), "alberta.tech");
  assert.equal(cleanHandle("https://www.youtube.com/@CleoAbram/shorts"), "CleoAbram");
  assert.equal(cleanHandle("drop table"), null);
});

test("образец ролика сам проходит проверку; длинный кадр и дыры в раскадровке ловятся", () => {
  const sample = normalizeVideo(VIDEO_SAMPLE);
  assert.deepEqual(videoIssues(sample), []);
  assert.equal(sample.script.split("\n\n").length, 5, "абзацы сценария — паузы телесуфлёра, их не склеиваем");
  const broken = normalizeVideo({ ...VIDEO_SAMPLE, hooks: VIDEO_SAMPLE.hooks.map((h) => ({ ...h, formulaId: 3 })), beats: [{ from: 0, to: 9, say: "x", screen: "", shot: "" }], seconds: 28 });
  const issues = videoIssues(broken);
  assert.ok(issues.some((i) => i.includes("трёх разных формул")));
  assert.ok(issues.some((i) => i.includes("до 4 секунд")));
  assert.ok(issues.some((i) => i.includes("от 0 до seconds")));
});

test("сюжет 3Д: 2–3 предложения и короткая первая реплика", () => {
  assert.deepEqual(sketchIssues({ kind: "sketch", title: "Миллион одноклассника", plot: "Одноклассник хвастается миллионом на мемкоине. Я покупаю после роста в сто раз. Монета падает — его миллион оплатил я.", opening: "Клод, одноклассник поднял миллион на мемкоине.", formulaUse: "" }), []);
  const long = sketchIssues({ kind: "sketch", title: "x", plot: "Раз. Два. Три. Четыре. Пять.", opening: "Да", formulaUse: "" });
  assert.equal(long.length, 2);
});

test("разбор: неизвестная формула становится неразмеченной, номер — именем из списка", () => {
  const known = normalizeAnalysis({ formulaId: "3", formulaName: "что угодно", hookSpoken: "Nobody tells you", structure: ["0–2 с: зацепка"], why: "…" });
  assert.equal(known.formulaName, "Никто не говорит");
  const unknown = normalizeAnalysis({ formulaId: 99, formulaName: "Чужой комментарий", shape: "открывается чужим комментарием" });
  assert.equal(unknown.formulaId, null);
  assert.equal(unknown.shape, "открывается чужим комментарием");
});

test("сводка прогона: счёт формул и честная уверенность", () => {
  const card = (formulaId: number | null): TrendCard => ({ key: "instagram:x", runId: "r", theme: "ai_tech", source: "instagram", handle: "a", url: "", views: 1, median: 1, multiple: 3, followers: null, frames: [], state: "ready", at: "",
    analysis: { formulaId, formulaName: "", hookSpoken: "", hookRu: "", hookScreen: "", structure: [], seconds: null, ask: "", why: "" } });
  const s = runSummary([read("a", [1, 1, 1, 1, 1, 1, 9])], [card(3), card(3), card(null)]);
  assert.deepEqual(s.formulas.map((f) => [f.formulaId, f.count]), [[3, 2], [null, 1]]);
  assert.match(confidence(12, 2, 3), /слишком мала/);
  assert.match(confidence(45, 7, 5), /хватает/);
});

test("формат нашего варианта: в 3Д только сценки, «ИИ и технологии» — всегда ролик", () => {
  assert.equal(ideaKindOf("sketch", "video"), "video");
  assert.equal(ideaKindOf("sketch"), "sketch");
  assert.equal(ideaKindOf("ai_tech", "sketch"), "video");
  assert.equal(ideaKindOf("global", "sketch"), "sketch");
  assert.equal(ideaKindOf("global"), "video");
  assert.equal(normalizeAnalysis({ formulaId: 18, fit: "sketch" }).fit, "sketch");
  assert.equal(normalizeAnalysis({ formulaId: 18, fit: "drama" }).fit, undefined);
});

test("сюжет 3Д получает шутку оригинала: пересказ сценки и её реплики", () => {
  const analysis = normalizeAnalysis({ formulaId: 21, hookSpoken: "Oh, she's stealing.", structure: ["0–2 с: обвинение"], why: "…", fit: "sketch", story: "Мама думает, что дочь ворует, а это её же покупки." });
  assert.equal(analysis.story, "Мама думает, что дочь ворует, а это её же покупки.");
  const card = { key: "instagram:abcdef", runId: "r", theme: "global", source: "instagram", handle: "a", url: "", views: 9, median: 1, multiple: 9, followers: null, frames: [], state: "ready", at: "",
    caption: "We're cooked", transcript: "[0.0 с] Oh, she's stealing.", analysis } as TrendCard;
  const sketch = ideaUser(card, "25 октября 2026", "sketch");
  assert.match(sketch, /Что происходит в ролике: Мама думает/);
  assert.match(sketch, /Реплики оригинала/);
  assert.doesNotMatch(sketch, /шутки остаются автору/);
  assert.match(ideaUser(card, "25 октября 2026", "video"), /шутки остаются автору/);
  assert.doesNotMatch(sketch, /Ритм оригинала/);
});

// кадры 36×64 из пёстрой текстуры блоками 3×3: на ней движение камеры даёт настоящую разницу кадров, как на видео
const textureFrame = (seed: number, shift = 0) => {
  const blocks = Array.from({ length: 64 * 22 }, (_, k) => Math.imul(k + seed * 7919, 2654435761) >>> 24);
  const out = new Uint8Array(RHYTHM_WIDTH * RHYTHM_HEIGHT * 3);
  for (let y = 0; y < RHYTHM_HEIGHT; y++)
    for (let x = 0; x < RHYTHM_WIDTH; x++)
      for (let c = 0; c < 3; c++) out[(y * RHYTHM_WIDTH + x) * 3 + c] = (blocks[Math.floor(y / 3) * 64 + (Math.floor((x + shift) / 3) % 64)] + c * 40) % 256;
  return out;
};
const mix = (a: Uint8Array, b: Uint8Array, t: number) => a.map((v, k) => Math.round(v * (1 - t) + b[k] * t));
const clip = (frames: Uint8Array[]) => Buffer.concat(frames);

test("ритм: резкая склейка и наплыв находятся, движение камеры склейкой не считается", () => {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < 30; i++) frames.push(textureFrame(1)); // 0–2 с: статичный план
  for (let i = 0; i < 30; i++) frames.push(textureFrame(2, i)); // 2–4 с: склейка, камера едет
  const last = textureFrame(2, 29), next = textureFrame(3);
  for (let i = 1; i <= 9; i++) frames.push(mix(last, next, i / 10)); // наплыв 0,6 с
  for (let i = 0; i < 36; i++) frames.push(next); // до 7 с
  const scan = findCuts(clip(frames));
  assert.equal(scan.cuts.length, 2);
  assert.ok(Math.abs(scan.cuts[0] - 2) < 0.1, `склейка на ${scan.cuts[0]}`);
  assert.ok(scan.cuts[1] > 4 && scan.cuts[1] < 4.6, `наплыв на ${scan.cuts[1]}`);

  const pan = findCuts(clip(Array.from({ length: 60 }, (_, i) => textureFrame(4, i))));
  assert.deepEqual(pan.cuts, []);
  assert.equal(pan.motion, "high");
  assert.deepEqual(findCuts(new Uint8Array(0)).cuts, []);
});

test("ритм: длины планов, склейки по половинам и темп речи; модели — цифры и как их перенести", () => {
  const words = [
    ...Array.from({ length: 10 }, (_, k) => ({ word: "w", start: 0.2 + 0.3 * k, end: 0.45 + 0.3 * k })),
    ...Array.from({ length: 6 }, (_, k) => ({ word: "w", start: 5 + 0.3 * k, end: 5.25 + 0.3 * k })),
  ];
  const r = rhythmOf({ cuts: [1.5, 3, 4, 7], duration: 10, motion: "calm" }, 10, words);
  assert.deepEqual(
    { shots: r.shots, median: r.shotMedian, min: r.shotMin, first3: r.shotsFirst3s, firstCut: r.firstCut, rate: r.cutRate },
    { shots: 5, median: 1.5, min: 1, first3: 2, firstCut: 1.5, rate: [0.6, 0.2] },
  );
  assert.deepEqual({ wps: r.wordsPerSec, start: r.speechStart, pauses: r.pauses }, { wps: 2.9, start: 0.2, pauses: 1 });
  assert.equal(rhythmOf({ cuts: [], duration: 5, motion: "high" }, 5, words.slice(0, 4)).wordsPerSec, undefined);

  const video = rhythmBlock(r, "video");
  assert.match(video, /^Ритм оригинала \(измерен по файлу\): 10 с, 5 планов; обычный план 1,5 с, самый короткий 1 с; в первые 3 с — 2 плана, первая склейка на 1,5 с; склейки в первой половине — раз в 1,7 с, во второй — одна; кадр спокойный; речь 2,9 слова в секунду, с первого кадра, пауз дольше секунды — 1\./);
  assert.match(video, /кадр в beats длится около 1,5 с, в первые 3 секунды — 2 кадра/);
  assert.match(rhythmBlock(r, "sketch"), /план сменяется примерно раз в 1,5 с, в первые 3 секунды — 2 плана, реплики звучат так же плотно/);
  const oneShot = rhythmOf({ cuts: [], duration: 21.3, motion: "calm" }, 21.3);
  assert.match(rhythmBlock(oneShot, "video"), /21,3 с, 1 план; кадр спокойный\.\nОригинал держится на одном плане/);

  const analysis = normalizeAnalysis({ formulaId: 18, structure: ["0–2 с: зацепка"], why: "…", fit: "video" });
  const card = { key: "youtube:abcdef", runId: "r", theme: "global", source: "youtube", handle: "a", url: "", views: 9, median: 1, multiple: 9, followers: null, frames: [], state: "ready", at: "", analysis, rhythm: r } as TrendCard;
  assert.match(ideaUser(card, "31 октября 2026", "video"), /Ход ролика:[\s\S]*Ритм оригинала[\s\S]*Почему сработал/);
});

test("аккаунты: темы ждут решения, гиганты добавлены один раз утверждёнными; очередь — кого дольше не читали", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trends-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const { changeAccounts, listAccounts, runAccounts } = await import("../lib/trends/accounts");
    const first = listAccounts();
    const themed = first.filter((a) => a.theme !== "global");
    const global = first.filter((a) => a.theme === "global");
    assert.ok(themed.length >= 20 && themed.every((a) => a.status === "proposed"));
    assert.ok(global.length >= 150 && global.every((a) => a.status === "active"), `гигантов ${global.length}`);
    assert.equal(new Set(global.map((a) => (a.instagram ?? `yt:${a.youtube}`).toLowerCase())).size, global.length, "без повторов");
    assert.equal(runAccounts("global").length, 100);
    // убранный гигант не возвращается при следующем чтении списка
    changeAccounts({ action: "remove", id: global[0].id });
    assert.equal(listAccounts().filter((a) => a.theme === "global").length, global.length - 1);
    // очередь: ни разу не прочитанные первыми, потом самые давние
    const ids = global.slice(1, 4).map((a) => a.id);
    const read = new Map(global.slice(1).map((a, i) => [a.id, `2026-10-2${i % 2}T00:00:00Z`]));
    read.set(ids[0], "2026-10-01T00:00:00Z");
    read.delete(ids[1]);
    assert.deepEqual(runAccounts("global", read).slice(0, 2).map((a) => a.id), [ids[1], ids[0]]);

    assert.deepEqual(runAccounts("sketch"), []);
    const outsized = first.find((a) => a.theme === "sketch" && a.role === "outsized")!;
    const direct = first.find((a) => a.theme === "sketch" && a.role === "direct")!;
    changeAccounts({ action: "approve", id: outsized.id });
    changeAccounts({ action: "approve", id: direct.id });
    assert.deepEqual(runAccounts("sketch", new Map()).map((a) => a.id), [direct.id, outsized.id]);
    changeAccounts({ action: "add", theme: "sketch", role: "adjacent", instagram: "https://www.instagram.com/new.one/" });
    assert.throws(() => changeAccounts({ action: "add", theme: "sketch", instagram: "@New.One" }), /уже в списке/);
    assert.throws(() => changeAccounts({ action: "add", theme: "sketch" }), /Укажите ник/);
    changeAccounts({ action: "remove", id: direct.id });
    assert.equal(listAccounts().some((a) => a.id === direct.id), false);
  } finally {
    process.chdir(cwd);
    // Windows иногда держит только что переименованный файл: временная папка не должна прятать ошибку теста
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
});
