import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { contentProblems, extractJson, glue, parseContent, parseResearch, rich, ruleProblems, tx, windowUrl } from "../lib/carousel/sid/content";
import { coverHtml } from "../lib/carousel/sid/html";
import { nextPaletteIndex, SID_PALETTE } from "../lib/carousel/sid/palette";
import { cleanOffset, cropAround } from "../lib/carousel/sid/shots";
import { addTopic, readTopics, SEED_TOPICS } from "../lib/carousel/sid/topics";
import { createSidCarousel } from "../lib/carousel/sid/create";
import { sidSlideHash } from "../lib/carousel/sid/hash";
import { coverPrompt } from "../lib/carousel/sid/cover";
import { slideContentHash } from "../lib/carousel/hash";
import { getCarousel, slideFilePath, updateCarousel, writeFileAtomic } from "../lib/carousel/store";
import { carouselStatus, publishReadiness } from "../lib/carousel/view";
import { shareSlides } from "../lib/carousel/share";
import { composeCaption, normalizeHashtags } from "../lib/carousel/text";

const NBSP = String.fromCharCode(160);

function freshRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-sid-"));
  process.env.CAROUSEL_DATA_DIR = dir;
  return dir;
}

const step = (i: number) => ({
  icon: "gavel",
  label: `CoinDesk · ${i + 1} октября`,
  title: `Шаг номер ${i + 1}.`,
  body: `Текст шага ${i + 1}: **$93,2 млн** из **315 кошельков**.`,
  pills: [["УКРАДЕНО", "$93,2 млн"], ["СЕТИ", "6"]],
  next: i === 6 ? "сохрани" : "дальше",
  source: i % 3,
});

const sample = () => ({
  topic: "Чип-шпион в кошельках",
  topicKey: "Ledger Spy Chip",
  cover: { pill: "срочно", title: ["Шпион", "в ledger."], accentLine: "он сливал seed-фразы.", hook: "Что известно и что скрывают →", scene: "An opened generic hardware wallet under a lamp." },
  steps: Array.from({ length: 7 }, (_, i) => step(i)),
  final: { black: ["Сохрани", "и перешли другу."], accent: ["Где ты брал", "кошелёк?"], cards: [["LTE", "eSIM", "читал 24 слова"], ["$", "93,2 млн", "по Bitquery"], ["315", "кошельков", "6 сетей"]], body: "У производителя или у перекупщика? Пиши в комментариях." },
  caption: "В кошельках нашли чип.\nГде ты покупал кошелёк? Пиши в комментариях.",
  sources: [
    { url: "https://www.coindesk.com/a", title: "A", publisher: "CoinDesk" },
    { url: "https://decrypt.co/b", title: "B", publisher: "Decrypt" },
    { url: "https://github.com/bitcoin/bips/blob/master/bip-0361.mediawiki", title: "C", publisher: "GitHub" },
  ],
});

test("JSON из ответа модели: голый, в ```json и с фразой вокруг", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Вот ответ:\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('Готово. {"a":3} — всё'), { a: 3 });
  assert.throws(() => extractJson("нет json"));
});

test("содержимое карусели: капс, ключ темы, иконка по умолчанию, источник шага обязателен", () => {
  const raw = sample();
  (raw.steps[0] as any).icon = "unknown";
  const c = parseContent(raw);
  assert.equal(c.cover.pill, "СРОЧНО");
  assert.equal(c.cover.title[0], "ШПИОН");
  assert.equal(c.topicKey, "ledger-spy-chip");
  assert.equal(c.steps[0].icon, "doc");
  assert.equal(c.steps.length, 7);
  const broken = sample();
  (broken.steps[3] as any).source = 9;
  assert.throws(() => parseContent(broken), /Шаг 4: не указан источник/);
  const short = sample();
  short.steps.pop();
  assert.throws(() => parseContent(short), /ровно 7/);
});

test("исследование: нужны факты с цитатами и адресами, страницы только шагов 1–7", () => {
  const facts = Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, claim: "утверждение", quote: "quote", url: `https://example.com/${i}`, publisher: "X" }));
  const r = parseResearch({ topic: "Тема", topicKey: "Тема Key!", facts, pages: [{ step: 1, url: "https://a.com/1" }, { step: 9, url: "https://a.com/9" }, { step: 2, url: "javascript:alert(1)" }] });
  assert.equal(r.topicKey, "key");
  assert.equal(r.pages.length, 1);
  assert.throws(() => parseResearch({ topic: "Т", topicKey: "t", facts: facts.slice(0, 3) }), /не меньше 8/);
});

test("правила подписи: без хэштегов, эмодзи и Telegram, с вопросом", () => {
  const c = parseContent(sample());
  assert.deepEqual(contentProblems(c).filter((p) => p.startsWith("caption")), []);
  c.caption = "Подпись #крипта 🚀 подпишись на Telegram";
  const p = contentProblems(c).join(" | ");
  assert.match(p, /без хэштегов/);
  assert.match(p, /без эмодзи/);
  assert.match(p, /Telegram/);
  assert.match(p, /вопрос/);
});

test("склейка: предлоги и числа не отрываются, жирное — в <b>", () => {
  assert.equal(glue("в кошельке 315 кошельков на $93,2 млн USDT"), `в${NBSP}кошельке 315${NBSP}кошельков на${NBSP}$93,2${NBSP}млн${NBSP}USDT`);
  assert.equal(rich("**<x>** и **y**"), `<b>&lt;x&gt;</b> и${NBSP}<b>y</b>`);
  assert.equal(windowUrl("https://www.coindesk.com/business/2026/10/09/x"), "coindesk.com");
  assert.equal(windowUrl("https://github.com/bitcoin/bips/blob/master/bip-0361.mediawiki"), "github.com/bitcoin/bips");
});

test("цвета идут по кругу и не повторяют предыдущий", () => {
  assert.equal(nextPaletteIndex([]), 0);
  assert.equal(nextPaletteIndex([3, 2, 1, 0]), 4);
  assert.equal(nextPaletteIndex([SID_PALETTE.length - 1]), 0);
  assert.equal(new Set(SID_PALETTE.map((p) => p.accent)).size, SID_PALETTE.length);
});

test("кадр вокруг заголовка: в пределах окна и в пропорции окна шага", () => {
  const c = cropAround({ left: 30, top: 900, width: 840 });
  assert.equal(c.w, 888);
  assert.equal(c.x, 6);
  assert.ok(Math.abs(c.w / c.h - 956 / 378) < 0.01);
  assert.ok(c.y < 900 && c.y > 800);
  const narrow = cropAround({ left: 400, top: 10, width: 120 });
  assert.equal(narrow.w, 600);
  assert.equal(narrow.x, 300);
  assert.equal(narrow.y, 0);
});

test("края кадра идут по пустым строкам, а не по тексту", () => {
  const width = 10;
  const rows = 60;
  const gray = new Uint8Array(width * rows).fill(255);
  // «строки текста» — полосы с перепадом яркости
  const ink = (from: number, to: number) => {
    for (let y = from; y < to; y++) for (let x = 0; x < width; x += 2) gray[y * width + x] = 0;
  };
  ink(8, 14);
  ink(46, 52);
  // без сдвига (slack = 10) верх попадает на строку 10 — внутри текста; первый чистый вариант рядом — 14
  const dy = cleanOffset(gray, width, rows, 30, 10);
  assert.ok(dy >= 14, `сдвиг ${dy}`);
  for (const y of [dy, dy + 1, dy + 2, dy + 3, dy + 26, dy + 27, dy + 28, dy + 29]) assert.equal(gray[y * width], 255);
});

test("обложка: без букв и узнаваемых людей, низ под заголовок", () => {
  const p = coverPrompt("A bank vault with an empty box.");
  assert.match(p, /Scene: A bank vault/);
  assert.match(p, /no text anywhere/i);
  assert.match(p, /no recognizable real person/i);
  assert.match(p, /lower third/);
});

test("темы: одобренные четыре всегда в списке, повтор ключа не дублируется", () => {
  freshRoot();
  assert.deepEqual(readTopics().map((t) => t.key).sort(), SEED_TOPICS.map((t) => t.key).sort());
  addTopic({ key: "new-story", title: "Новая история", at: "2026-10-28T10:00:00Z", carouselId: "c1" });
  addTopic({ key: "new-story", title: "Новая история (повтор)", at: "2026-10-28T11:00:00Z", carouselId: "c2" });
  const list = readTopics();
  assert.equal(list.filter((t) => t.key === "new-story").length, 1);
  assert.equal(list[0].key, "new-story");
});

test("карусель формата: свой цвет по кругу, готовые слайды не устаревают и проходят проверку публикации", () => {
  freshRoot();
  const a = createSidCarousel({}, new Date("2026-10-28T10:00:00Z"));
  const b = createSidCarousel({}, new Date("2026-10-28T10:01:00Z"));
  assert.equal(a.schema, 4);
  assert.equal(b.sid!.palette, (a.sid!.palette + 1) % SID_PALETTE.length);
  assert.notEqual(a.sid!.accent, b.sid!.accent);
  assert.equal(carouselStatus(getCarousel(a.id)!).text, "Черновик");
  const ids = Array.from({ length: 9 }, (_, i) => `s${"x".repeat(11)}${i}`);
  updateCarousel(a.id, (x) => {
    x.slides = ids.map((id, i) => {
      const file = `slide-${id}-${"a".repeat(11)}${i}.jpg`;
      writeFileAtomic(slideFilePath(a.id, file), Buffer.from([0xff, 0xd8, 0xff]));
      return { id, kind: i === 0 ? "cover" : i === 8 ? "final" : "content", kicker: "", title: "t", body: "", bullets: [], cta: "", render: { hash: sidSlideHash(id), file, at: "2026-10-28T10:00:00Z" } };
    });
    x.caption = "Подпись. Вопрос? Пиши в комментариях.";
  });
  const c = getCarousel(a.id)!;
  assert.equal(c.schema, 4, "schema 4 сохраняется при чтении");
  assert.equal(slideContentHash(c, c.slides[3], 3, 9), sidSlideHash(c.slides[3].id));
  assert.deepEqual(publishReadiness(c), []);
  assert.equal(carouselStatus(c).text, "Готово");
});

test("плашка со знаком вопроса вместо значения отправляется на переписывание; в заголовке «млн» не склеивается дальше", async () => {
  const { ruleProblems } = await import("../lib/carousel/sid/content");
  const c = parseContent(sample());
  assert.deepEqual(ruleProblems(c), []);
  c.steps[2].pills[1] = ["СУММА", "?"];
  assert.match(ruleProblems(c).join(" "), /steps\[2\]\.pills\[1\]: значение плашки без значения/);
  // в тексте шага «млн» держится со следующим словом, в заголовке — нет
  assert.equal(glue("$60 млн за 15 месяцев"), `$60${NBSP}млн${NBSP}за${NBSP}15${NBSP}месяцев`);
  assert.equal(glue("$60 млн за 15 месяцев", true), `$60${NBSP}млн за${NBSP}15${NBSP}месяцев`);
});

test("плашки и карточки только с настоящим значением", async () => {
  const { pillProblem, ruleProblems } = await import("../lib/carousel/sid/content");
  for (const bad of ["", "?", "—", "неизвестно", "Не раскрыто", "неясно", "нет данных", "unknown"]) assert.ok(pillProblem(bad), `«${bad}» не значение`);
  for (const good of ["$93,2 млн", "Draft", "на паузе", "не доказан", "нет", "22 октября", "Сумит Гупта"]) assert.equal(pillProblem(good), null, `«${good}» — значение`);
  const c = parseContent(sample());
  c.steps[2].pills[1] = ["СУММА", "неизвестно"];
  c.final.cards[1] = ["$", "?", "украдено"];
  const p = ruleProblems(c).join(" | ");
  assert.match(p, /steps\[2\]\.pills\[1\]: значение плашки не значение — «СУММА неизвестно»/);
  assert.match(p, /final\.cards\[1\]: крупное значение карточки без значения/);
  // «? · сумма · не раскрыта» — неизвестное в роли главной цифры; «$ · 2 млрд · через USD1» и «СУД · закрыто · 23 октября» — значения
  const d = parseContent(sample());
  d.final.cards = [["?", "сумма", "не раскрыта"], ["$", "2 млрд", "через USD1"], ["СУД", "закрыто", "23 октября"]];
  const q = ruleProblems(d);
  assert.equal(q.length, 1);
  assert.match(q[0], /final\.cards\[0\]: крупное значение карточки со знаком вопроса — «\? · сумма · не раскрыта»/);
});

test("неподтверждённое: находится в тексте, плашках, карточках и подписи, без учёта жирного и кавычек", async () => {
  const { leftoverFragments } = await import("../lib/carousel/sid/content");
  const c = parseContent(sample());
  c.steps[1].pills[0] = ["ДЕЛО", "26-cv-03686"];
  c.steps[4].body = "Истец — **бывший инженер** Circle.";
  c.final.cards[2] = ["$", "187 млн", "семье"];
  c.caption = "Иск «Greenberg v. Trump». Что дальше? Пиши в комментариях.";
  assert.deepEqual(leftoverFragments(c, ["26-cv-03686", "бывший инженер", "187 млн", "Greenberg v. Trump", "нет такого", "ab"]), ["26-cv-03686", "бывший инженер", "187 млн", "Greenberg v. Trump"]);
  c.steps[1].pills[0] = ["СУД", "округ Колумбия"];
  assert.deepEqual(leftoverFragments(c, ["26-cv-03686"]), []);
});

test("окна не повторяются: шаг с той же страницей получает другую — сначала из своих фактов и другого издания", async () => {
  const { dedupeSteps } = await import("../lib/carousel/sid/content");
  const raw = sample();
  raw.sources = Array.from({ length: 7 }, (_, i) => ({ url: i === 0 ? "https://www.coindesk.com/a" : `https://site${i}.example/p${i}`, title: `S${i}`, publisher: `P${i}` }));
  raw.steps.forEach((s, i) => (s.source = i));
  // шаги 1, 4 и 7 (индексы 0, 3, 6) смотрят на одну страницу CoinDesk
  raw.steps[3].source = 0;
  raw.steps[6].source = 0;
  const c = parseContent(raw);
  c.steps[6].facts = ["f3"];
  const research = {
    facts: [
      { id: "f1", claim: "a", quote: "q", url: "https://www.coindesk.com/a", publisher: "CoinDesk" },
      { id: "f2", claim: "b", quote: "q", url: "https://www.coindesk.com/other", publisher: "CoinDesk" },
      { id: "f3", claim: "Факт шага семь", quote: "q", url: "https://www.theblock.co/post/7", publisher: "The Block", date: "2026-10-25" },
    ],
    pages: [{ step: 4, url: "https://news.bitcoin.com/x", publisher: "Bitcoin.com", headline: "Заголовок" }],
  };
  const { content, changes } = dedupeSteps(c, research);
  const urls = content.steps.map((s) => content.sources[s.source].url);
  assert.equal(new Set(urls).size, 7, "все окна разные");
  assert.equal(urls[6], "https://www.theblock.co/post/7", "шаг 7 взял страницу своего факта другого издания");
  assert.equal(new URL(urls[3]).hostname, "news.bitcoin.com", "шаг 4 — другое издание, а не вторая страница CoinDesk");
  assert.equal(changes.length, 2);
  assert.equal(c.steps[6].source, 0, "исходное содержимое не меняется");
  const lonely = parseContent(sample());
  assert.throws(() => dedupeSteps(lonely, { facts: [], pages: [] }), /та же страница, что у шага 1/);
});

test("«В Instagram»: слайды уходят строго 01→09 с номером в имени; неполную карусель не отдаём", () => {
  const slides = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, render: { file: `sid-${i}-abc.jpg`, hash: "", at: "" } }));
  const list = shareSlides("c1", slides as never)!;
  assert.deepEqual(list.map((x) => x.name), ["01", "02", "03", "04", "05", "06", "07", "08", "09"].map((n) => `slide-${n}.jpg`));
  assert.deepEqual(list.map((x) => x.url), slides.map((s) => `/api/carousel/c1/image/${s.render.file}`));
  assert.equal(shareSlides("c1", [...slides.slice(0, 8), { id: "s8" }] as never), null, "слайд без файла");
  assert.equal(shareSlides("c1", [...slides.slice(0, 8), { id: "s8", render: { file: "x.jpg", error: "сбой" } }] as never), null, "слайд с ошибкой");
  assert.equal(shareSlides("c1", slides as never, ["s3"]), null, "устаревший слайд");
  assert.equal(shareSlides("c1", []), null);
  // в буфер — подпись ровно такой, какой её отправит публикация с сайта
  assert.equal(composeCaption("Строка один.\nКак думаешь?", normalizeHashtags("")), "Строка один.\nКак думаешь?");
});

test("пунктуация: длинное тире и «экс-» ловятся до вёрстки, двоеточие и диапазоны чисел проходят", () => {
  const bad = parseContent(sample());
  bad.steps[1].title = "Истец — экс-инженер Circle.";
  bad.steps[2].body = "Работал в **2016–2018** и владеет акциями.";
  bad.caption = "Иск подан — решения нет.\nКак думаешь? Пиши в комментариях.";
  const problems = ruleProblems(bad);
  assert.ok(problems.some((p) => p.startsWith("steps[1].title: длинное тире;")), problems.join("\n"));
  assert.ok(problems.some((p) => p.startsWith("steps[1].title: вместо «экс-» пиши «бывший»")), problems.join("\n"));
  assert.ok(problems.some((p) => p.startsWith("caption: длинное тире;")), problems.join("\n"));
  assert.ok(!problems.some((p) => p.startsWith("steps[2]")), "диапазон 2016–2018 без пробелов — не тире");
  const good = parseContent(sample());
  good.steps[1].title = "Истец: бывший инженер Circle.";
  good.caption = "Иск подан, решения нет.\nКак думаешь? Пиши в комментариях.";
  assert.deepEqual(ruleProblems(good).filter((p) => /тире|экс-/.test(p)), []);
});

test("слова с дефисом не рвутся переносом: «Нью-Йорк», «SEED-фразы» — одним куском, числа и разметка не задеты", () => {
  assert.equal(tx("экс-инженер"), '<span style="white-space:nowrap">экс-инженер</span>');
  const html = rich("Суд **Нью-Йорка** вернул SEED-фразы за 2016–2018");
  assert.match(html, /<b><span style="white-space:nowrap">Нью-Йорка<\/span><\/b>/);
  assert.match(html, /<span style="white-space:nowrap">SEED-фразы<\/span>/);
  assert.match(html, /2016–2018/);
  assert.ok(!/nowrap">2016/.test(html), "диапазон через короткое тире не трогается");
});

const hasSidFonts = fs.existsSync("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf") || Boolean(process.env.CAROUSEL_SID_FONT_DIR);

test("обложка громкая: 2–3 огромные строки, последняя акцентом, под ними строка с главной цифрой", { skip: hasSidFonts ? false : "нет шрифтов Liberation — тест идёт в образе сайта" }, () => {
  const c = parseContent(sample());
  const html = coverHtml(c, { accent: "#3F8A3A", coverAccent: "#9BE38F", handle: "@owner.threads" }, "data:image/png;base64,");
  assert.deepEqual([...html.matchAll(/<div class="hx( a)?">(.*?)<\/div>/g)].map((m) => [Boolean(m[1]), m[2]]), [[false, "ШПИОН"], [true, `В${NBSP}LEDGER.`]]);
  const has = (part: string) => assert.ok(html.includes(part), `на обложке нет «${part}»`);
  has(`<div class="ac" id="ac">ОН${NBSP}СЛИВАЛ <span style="white-space:nowrap">SEED-ФРАЗЫ</span>.</div>`);
  has(".hx{white-space:nowrap;font-size:168px");
  has(".hx.a{color:#9BE38F}");
  assert.ok(!html.includes("—"), "на обложке нет длинного тире");
});
