import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { editProblems, extractJson, fitSlideCount, generationSystem, generationUser, normalizeDraft, normalizeRegenerated, repairUser, WRITER_RULES } from "../lib/carousel/prompt";
import { buildSlideHtml, slideHash } from "../lib/carousel/templates";
import { buildDeckHtml, deckHash, qrSvg } from "../lib/carousel/deckHtml";
import { channelTitle, TELEGRAM_CHANNEL } from "../lib/carousel/channel";
import { deckAltText, deckKindAt, wordCount } from "../lib/carousel/deck";
import { slideContentHash } from "../lib/carousel/hash";
import { applyManualEdit } from "../lib/carousel/edit";
import { CAROUSEL_STYLES } from "../lib/carousel/styles";
import type { Slide } from "../lib/carousel/types";

const CONTENT = [
  { kind: "content", kicker: "Шаг 1", title: "Ложитесь в одно время", body: "Стабильный режим важнее длины сна: организм привыкает засыпать быстрее.", bullets: [] },
  { kind: "content", kicker: "Шаг 2", title: "Утром выходите на свет", body: "Дневной свет в первые часы помогает вечером почувствовать сонливость.", bullets: [] },
  { kind: "content", kicker: "Шаг 3", title: "Кофе — только до обеда", body: "", bullets: ["Последняя чашка до 14:00", "Крепкий чай тоже бодрит"] },
  { kind: "content", kicker: "Шаг 4", title: "Прохладная тёмная спальня", body: "Проветрите комнату и уберите яркие источники света перед сном.", bullets: [] },
  { kind: "content", kicker: "Шаг 5", title: "Телефон за час до сна", body: "Ленты и сообщения держат мозг в напряжении — отложите экран заранее.", bullets: [] },
];

function plan() {
  const slides = [
    { kind: "cover", kicker: "Сон", title: "Как **высыпаться** за семь часов", body: "Простые привычки без таблеток", cta: "лишнее" },
    ...CONTENT.map((s) => ({ ...s, cta: "тоже лишнее" })),
    { kind: "final", kicker: "Итог", title: "Начните с одной привычки", body: "Выберите пункт и держите его неделю.", bullets: ["лишний список"], cta: "Сохрани, чтобы не потерять" },
  ];
  return {
    title: "Как высыпаться",
    story: slides.map((_, i) => `роль ${i + 1}`),
    slides,
    caption: "Первая строка-крючок.\n\nТекст подписи. Какая привычка вам ближе?\n\n#сон #здоровье",
    hashtags: ["#привычки"],
    claimsToCheck: [],
  };
}

test("хороший ответ разбирается без замечаний; поля не своего типа отбрасываются", () => {
  const r = normalizeDraft(plan(), { expectedCount: 7 });
  assert.deepEqual(r.fatal, []);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(
    r.draft.slides.map((s) => s.kind),
    ["cover", "content", "content", "content", "content", "content", "final"],
  );
  assert.equal(r.draft.slides[0].cta, "");
  assert.equal(r.draft.slides[1].cta, "");
  assert.deepEqual(r.draft.slides[6].bullets, []);
  assert.equal(r.draft.slides[6].cta, "Сохрани, чтобы не потерять");
  assert.deepEqual(r.draft.hashtags, ["#привычки", "#сон", "#здоровье"]);
  assert.ok(!r.draft.caption.includes("#"));
});

test("число карточек: не то — замечание, меньше трёх — непоправимо", () => {
  const p = plan();
  p.slides = [p.slides[0], p.slides[1], p.slides[2], p.slides[3], p.slides[6]];
  assert.match(normalizeDraft(p, { expectedCount: 7 }).problems.join(), /ровно 7/);
  const tiny = plan();
  tiny.slides = [tiny.slides[0], tiny.slides[6]];
  assert.match(normalizeDraft(tiny, { expectedCount: 7 }).fatal.join(), /минимум 3/);
});

test("длина, повторы и хэштеги на карточке — замечания для исправления", () => {
  const p = plan();
  p.slides[2] = { ...p.slides[2], body: "Очень длинный текст ".repeat(25) };
  p.slides[5] = { ...p.slides[5], title: p.slides[1].title };
  p.slides[3] = { ...p.slides[3], body: "Пейте воду #здоровье" };
  const problems = normalizeDraft(p, { expectedCount: 7 }).problems.join("\n");
  assert.match(problems, /карточка 3: body \d+ символов при пределе 200/);
  assert.match(problems, /карточки 2 и 6: заголовки повторяют друг друга/);
  assert.match(problems, /карточка 4: хэштеги на карточке/);
});

test("пустой заголовок — непоправимо", () => {
  const p = plan();
  p.slides[4] = { ...p.slides[4], title: "  " };
  assert.match(normalizeDraft(p, { expectedCount: 7 }).fatal.join(), /карточка 5: пустой заголовок/);
});

test("JSON извлекается из ограждения и из текста с преамбулой", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Вот ответ:\n```json\n{"a":{"b":2}}\n```'), { a: { b: 2 } });
  assert.throws(() => extractJson("нет json"), /не разобрался/);
});

test("лишние карточки после исправления убираются, заключительная остаётся последней", () => {
  const p = plan();
  p.slides.splice(6, 0, { ...CONTENT[0], title: "Шестая мысль про сон", cta: "" }, { ...CONTENT[1], title: "Седьмая мысль про отдых", cta: "" });
  const draft = fitSlideCount(normalizeDraft(p).draft, 7);
  assert.equal(draft.slides.length, 7);
  assert.equal(draft.slides[6].kind, "final");
  assert.equal(draft.slides[6].title, "Начните с одной привычки");
  assert.equal(draft.slides[0].kind, "cover");
});

test("правка: id существующих слайдов сохраняются, чужие и повторные — сбрасываются", () => {
  const existing = [{ id: "sexisting000001" }, { id: "sexisting000002" }] as Slide[];
  const p = plan();
  (p.slides[0] as any).id = "sexisting000001";
  (p.slides[1] as any).id = "sunknown0000000";
  (p.slides[2] as any).id = "sexisting000001";
  const r = normalizeDraft(p, { existing });
  assert.equal(r.draft.slides[0].id, "sexisting000001");
  assert.equal(r.draft.slides[1].id, undefined);
  assert.equal(r.draft.slides[2].id, undefined);
});

test("правка по поручению: замечания только к изменённым карточкам и подписи", () => {
  const base = normalizeDraft(plan()).draft;
  const current = {
    slides: base.slides.map((s, i) => ({ ...s, id: `sid00000000000${i}` })) as Slide[],
    caption: base.caption,
    hashtags: base.hashtags,
  };
  // в нетронутой карточке 2 давно длинный текст — поручение касалось только карточки 4
  current.slides[1] = { ...current.slides[1], body: "Старый длинный текст ".repeat(15).trim() };
  const answer = {
    slides: current.slides.map((s, i) => (i === 3 ? { ...s, body: "Новый текст ".repeat(30).trim() } : s)),
    caption: current.caption,
    hashtags: current.hashtags,
  };
  const parsed = normalizeDraft(answer, { existing: current.slides });
  assert.ok(parsed.problems.some((p) => p.startsWith("карточка 2:")), "проверка видит старое превышение");
  const relevant = editProblems(parsed, current);
  assert.ok(relevant.some((p) => p.startsWith("карточка 4:")));
  assert.ok(!relevant.some((p) => p.startsWith("карточка 2:")), "нетронутая карточка не отправляется на исправление");

  const captionEdit = normalizeDraft({ ...answer, slides: current.slides, caption: "x".repeat(2300) }, { existing: current.slides });
  assert.ok(editProblems(captionEdit, current).some((p) => p.startsWith("caption:")));
});

test("перегенерация слайда сохраняет его тип", () => {
  const slides = normalizeDraft(plan()).draft.slides.map((s, i) => ({ ...s, id: `sid00000000000${i}` })) as Slide[];
  const r = normalizeRegenerated({ slide: { kind: "cover", title: "Свет по утрам", body: "Выходите на улицу в первый час после подъёма.", cta: "лишний" } }, { slides }, 2);
  assert.equal(r.slide.kind, "content");
  assert.equal(r.slide.cta, "");
  assert.deepEqual(r.fatal, []);
});

test("запрос к Claude: число карточек, язык, идея; исправление перечисляет замечания", () => {
  const user = generationUser({ idea: "Как высыпаться", wishes: "", slideCount: 7, language: "ru", style: "graphite", format: "square" }, new Date("2026-09-13T00:00:00Z"));
  assert.match(user, /Сегодня 2026-09-13/);
  assert.match(user, /ровно 7/);
  assert.match(user, /на русском языке/);
  assert.match(user, /«Как высыпаться»/);
  assert.match(user, /Квадратная карточка/);
  assert.match(repairUser({ a: 1 }, ["карточка 2: пустой заголовок"]), /- карточка 2: пустой заголовок/);
});

const base = { style: "graphite" as const, format: "portrait" as const, language: "ru" as const, footer: "@gudini" };
const slide = (over: Partial<Slide> = {}): Slide => ({ id: "sabcdefabcdef1", kind: "content", kicker: "Шаг 1", title: "Заголовок", body: "Текст", bullets: [], cta: "", ...over });

test("шаблон: текст модели экранируется, скриптов и внешних адресов нет", () => {
  const html = buildSlideHtml({
    carousel: base,
    slide: slide({ title: '<img src=x onerror="alert(1)">', body: "</style><script>alert(1)</script>", kicker: "https://evil.example" }),
    index: 1,
    total: 5,
    scale: 1,
    fontCss: "",
  });
  assert.ok(!/<img|<script/i.test(html));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  const tags = html.match(/<[^>]+>/g) ?? [];
  assert.ok(
    tags.every((t) => !/\s(src|href|on\w+)=/i.test(t)),
    "в разметке нет атрибутов загрузки и обработчиков",
  );
  assert.ok(!/url\(\s*['"]?https?:/i.test(html), "стили не ссылаются на внешние адреса");
});

test("шаблон: акцент, номер, все стили и типы карточек собираются", () => {
  assert.match(buildSlideHtml({ carousel: base, slide: slide({ title: "Как **выспаться**" }), index: 1, total: 5, scale: 1, fontCss: "" }), /<span class="hl">выспаться<\/span>/);
  for (const st of CAROUSEL_STYLES) {
    for (const kind of ["cover", "content", "final"] as const) {
      const html = buildSlideHtml({ carousel: { ...base, style: st.id, format: "square" }, slide: slide({ kind }), index: 0, total: 3, scale: 0.86, fontCss: "" });
      assert.match(html, new RegExp(`kind-${kind}`));
    }
  }
});

test("отпечаток слайда меняется от текста, позиции, числа слайдов и стиля", () => {
  const h = slideHash(base, slide(), 1, 5);
  assert.equal(slideHash(base, slide(), 1, 5), h);
  assert.notEqual(slideHash(base, slide({ title: "Другой" }), 1, 5), h);
  assert.notEqual(slideHash(base, slide(), 2, 5), h);
  assert.notEqual(slideHash(base, slide(), 1, 6), h);
  assert.notEqual(slideHash({ ...base, style: "paper" }, slide(), 1, 5), h);
  assert.notEqual(slideHash({ ...base, footer: "" }, slide(), 1, 5), h);
});

test("Codex caption newlines survive nested JSON transport without changing quotes or structure", () => {
  const raw = '{"caption":"Первая строка\n\nВторая строка с \\"цитатой\\"","slides":[{"title":"Готово"}]}';
  assert.equal(extractJson(raw).caption, 'Первая строка\n\nВторая строка с "цитатой"');
  assert.deepEqual(extractJson('{\n"caption":"строка\\nдругая", "path":"C:\\\\tmp"\n}'), { caption: 'строка\nдругая', path: 'C:\\tmp' });
  assert.throws(() => extractJson('{"caption":"обрыв'));
});

test("story rejects object entries instead of coercing them to object Object", () => {
  const p = { ...plan(), story: [{ role: "Обложка" }] };
  const r = normalizeDraft(p);
  assert.ok(!r.draft.story.some(s => s.includes("[object Object]")));
  assert.match(r.problems.join(" "), /story.*строк/);
});

// ---- карусель по скиллу ig-carousel (schema 3) ----

const CHANNEL = { name: "Алексей Гудов", tag: "FX GOLD", about: "сделки по золоту и биткоину", url: "https://t.me/+PRIVATE_INVITE", qr: TELEGRAM_CHANNEL!.qr };
const DECK = { channel: CHANNEL };
function deckPlan() {
  const s = (title: string, body = "", bullets: string[] = []) => ({ kind: "content", title, body, bullets, cta: "лишнее", kicker: "Шаг" });
  return {
    title: "Как высыпаться",
    story: ["зацепка", "ставка", "режим", "свет", "кофе", "экран", "итог", "Telegram"],
    slides: [
      s("Высыпайся **за 7 часов**", "Четыре привычки без таблеток"),
      s("Недосып съедает внимание сильнее, чем кажется утром"),
      s("Ложись в одно время", "Режим важнее длины сна: организм привыкает засыпать быстрее."),
      s("Утром выходи на свет", "Дневной свет в первые часы помогает вечером почувствовать сонливость."),
      s("Кофе только до обеда", "", ["Последняя чашка до 14:00", "Крепкий чай тоже бодрит"]),
      s("Телефон за час до сна", "Ленты держат мозг в напряжении — отложи экран заранее."),
      s("Коротко", "", ["Ложись в одно время", "Свет в первый час утра", "Кофе до 14:00", "Экран за час до сна"]),
      s("По привычке в день — в Telegram", "Лишняя строка"),
    ],
    caption: "Семь часов сна хватает, если мешает не время, а привычки.\n\nРежим, утренний свет, кофе и экран решают больше, чем кажется.\n\nНачни с одной привычки на этой неделе.\n\nПо одной привычке в день - в моём Telegram-канале, QR на последнем слайде.",
    hashtags: ["#сон", "#привычки", "#здоровье"],
    claimsToCheck: [],
  };
}

test("скилл: роли стоят по местам — обложка, ставка, мысли, итог, финал; ответ без замечаний", () => {
  const r = normalizeDraft(deckPlan(), { expectedCount: 8, deck: DECK });
  assert.deepEqual(r.fatal, []);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.draft.slides.map((s) => s.kind), ["cover", "stake", "content", "content", "content", "content", "recap", "final"]);
  // метки над заголовком в скилле нет, список — только у мыслей и итога
  assert.ok(r.draft.slides.every((s) => s.kicker === "" && s.cta === ""));
  assert.equal(r.draft.slides[6].bullets.length, 4);
  // финал — одна строка про канал: QR ставит сайт, лишний текст не хранится
  assert.equal(r.draft.slides[7].title, "По привычке в день — в Telegram");
  assert.equal(r.draft.slides[7].body, "");
});

test("скилл: минимум шесть слайдов, мемы и прежние карусели — от трёх", () => {
  const p = deckPlan();
  p.slides = [p.slides[0], p.slides[1], p.slides[2], p.slides[6], p.slides[7]];
  assert.match(normalizeDraft(p, { deck: DECK }).fatal.join(), /минимум 6/);
  assert.deepEqual(normalizeDraft(p).fatal, []);
});

test("скилл: длина считается словами — зацепка до 6, мысль 3–7 и до 25, итог списком, ставка одним предложением", () => {
  const p = deckPlan();
  p.slides[0] = { ...p.slides[0], title: "Как высыпаться за семь часов каждый день без таблеток", body: "" };
  p.slides[1] = { ...p.slides[1], body: "Лишний абзац под ставкой" };
  p.slides[2] = { ...p.slides[2], title: "Режим", body: "Очень длинный текст ".repeat(10) };
  p.slides[6] = { ...p.slides[6], bullets: ["Один пункт"] };
  const problems = normalizeDraft(p, { deck: DECK }).problems.join("\n");
  assert.match(problems, /карточка 1: зацепка обложки 9 слов, нужно до 6/);
  assert.match(problems, /карточка 1: под зацепкой нужна одна строка обещания/);
  assert.match(problems, /карточка 2: ставка — одно предложение в title/);
  assert.match(problems, /карточка 3: заголовок мысли 1 слов, нужно 3–7/);
  assert.match(problems, /карточка 3: текст под заголовком 30 слов, нужно до 25/);
  assert.match(problems, /карточка 7: в итоге 1 пунктов, нужно 3–5/);
  // итог крупно помещается в карточку поста, только если пункты короткие
  const wordy = deckPlan();
  wordy.slides[6] = { ...wordy.slides[6], bullets: ["Сеть совпадает с сетью депозита", "Мемо или тег вставлен, если нужен", "Адрес взят со страницы депозита", "Тестовая сумма идёт первой всегда"] };
  assert.match(normalizeDraft(wordy, { deck: DECK }).problems.join("\n"), /карточка 7: итог займёт около 8 строк, крупно помещается 7/);
});

test("скилл: Telegram — только на финале", () => {
  const p = deckPlan();
  p.slides[3] = { ...p.slides[3], body: "Подробнее разбираю в Telegram-канале." };
  p.slides[6] = { ...p.slides[6], bullets: ["Ложись в одно время", "Свет утром", "Подпишись на ТГ"] };
  const problems = normalizeDraft(p, { deck: DECK }).problems.join("\n");
  assert.match(problems, /карточка 4: Telegram упоминается только в финале/);
  assert.match(problems, /карточка 7: Telegram упоминается только в финале/);
  assert.doesNotMatch(problems, /карточка 8:/);
});

test("скилл: подпись по «Job B» — зацепка до 125 знаков, одно действие в Telegram без ника, 3–5 тегов, без ссылок", () => {
  const long = { ...deckPlan(), caption: `${"Очень длинная первая строка ".repeat(6)}\n\nСсылка https://t.me/owner_crypto`, hashtags: ["#a", "#b", "#c", "#d", "#e", "#f", "#g"] };
  const r = normalizeDraft(long, { deck: DECK });
  const problems = r.problems.join("\n");
  assert.match(problems, /caption: первая строка \d+ символов/);
  assert.match(problems, /caption: ссылки в подписи не кликаются/);
  assert.match(problems, /caption: хэштегов 7, нужно 3–5/);
  // Instagram принимает не больше пяти: лишние в пост не уходят, даже если исправление не удалось
  assert.equal(r.draft.hashtags.length, 5);
  const noAsk = normalizeDraft({ ...deckPlan(), caption: "Семь часов сна хватает.\n\nПривычки решают." }, { deck: DECK });
  assert.match(noAsk.problems.join("\n"), /caption: нет действия: последней строкой позови в Telegram-канал — QR на последнем слайде/);
  const nick = normalizeDraft({ ...deckPlan(), caption: "Семь часов сна хватает.\n\nПодробности в Telegram @owner_crypto." }, { deck: DECK });
  assert.match(nick.problems.join("\n"), /caption: ник с @ в подписи/);
});

test("скилл: при обрезке лишних мыслей итог и финал остаются в конце", () => {
  const p = deckPlan();
  p.slides.splice(6, 0, { ...p.slides[2], title: "Лишняя мысль про сон" });
  p.story.splice(6, 0, "лишняя");
  const draft = fitSlideCount(normalizeDraft(p, { deck: DECK }).draft, 8, false, DECK);
  assert.deepEqual(draft.slides.map((s) => s.kind), ["cover", "stake", "content", "content", "content", "content", "recap", "final"]);
  assert.equal(draft.slides[6].title, "Коротко");
  assert.equal(draft.story.length, 8);
  assert.equal(draft.story[7], "Telegram");
});

test("скилл: запрос называет роли, число мыслей и закрытый канал; ника Telegram и рисованного режима нет", () => {
  const req = { idea: "Как высыпаться", wishes: "", slideCount: 8, language: "ru" as const, style: "graphite" as const, format: "portrait" as const };
  const user = generationUser(req, { deck: true, design: { author: "TG:@owner_crypto" }, now: new Date("2026-10-24T00:00:00Z") });
  assert.match(user, /ровно 8 — обложка, ставка, 4 карточки-мысли, итог и финал/);
  assert.match(user, /Telegram-канал автора: «Алексей Гудов \| FX GOLD»/);
  assert.match(user, /вход по QR-коду на последнем слайде/);
  assert.doesNotMatch(user, /owner_crypto/);
  const system = generationSystem(false, { artworkMode: "painted", author: "TG:@owner_crypto", characterDescription: "Hero" }, true);
  assert.match(system, /cover — обложка/);
  assert.match(system, /recap — итог/);
  assert.match(system, /QR-код/);
  assert.doesNotMatch(system, /Hero|мастихином|image|owner_crypto/);
  assert.match(WRITER_RULES, /Telegram-канал автора/);
});

test("скилл: перегенерация финала — одна строка про канал", () => {
  const slides = normalizeDraft(deckPlan(), { deck: DECK }).draft.slides.map((s, i) => ({ ...s, id: `sid00000000000${i}` })) as Slide[];
  const r = normalizeRegenerated({ slide: { title: "Ещё разборы — в Telegram", body: "Каждый день по привычке", cta: "Жми" } }, { slides }, 7, false, false, DECK);
  assert.equal(r.slide.kind, "final");
  assert.equal(r.slide.body, "");
  assert.equal(r.slide.cta, "");
  assert.deepEqual(r.problems, []);
});

const deckDesignFixture = { accent: "#17633D", textColor: "#302820", scrimColor: "#F0E8D7", titleFont: "display" as const, author: "TG:@owner_crypto", illustrationStyle: "", igHandle: "owner.threads", avatarFile: "avatar-0123456789abcdef.png" };
const deckCarousel = { format: "portrait" as const, language: "ru" as const, design: deckDesignFixture };

test("шаблон скилла «пост»: поля 120 px, кегль не мельче 32, номер на обложке, ник и аватарка Instagram в шапке, без Telegram; текст экранируется", () => {
  const cover = buildDeckHtml({ ...deckCarousel, slide: slide({ kind: "cover", kicker: "", title: "Высыпайся **за 7 часов**", body: "</style><script>alert(1)</script>" }), index: 0, total: 8, scale: 0.74, fontCss: "", avatarDataUrl: "data:image/jpeg;base64,AAAA", channel: CHANNEL });
  assert.match(cover, />1\/8</);
  assert.match(cover, /<img class="ava" src="data:image\/jpeg;base64,AAAA"/);
  assert.match(cover, /class="nm"[^>]*>owner\.alex</);
  // ни подписи TG, ни значка Telegram в шапке
  assert.doesNotMatch(cover, /owner_crypto|class="tg"|Telegram|t\.me/);
  assert.match(cover, /padding:120px/);
  assert.match(cover, /<span class="hl">за\s7\sчасов<\/span>/);
  assert.ok(!/<script/i.test(cover));
  assert.match(cover, /Content-Security-Policy" content="default-src 'none'/);
  const sizes = [...cover.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 5 && sizes.every((n) => n >= 32), `кегль: ${sizes.join(", ")}`);
  const colors = new Set([...cover.matchAll(/#[0-9A-F]{6}\b/gi)].map((m) => m[0].toUpperCase()));
  // цвета оформления и белая карточка поста — второго акцента нет
  assert.deepEqual([...colors].filter((c) => !["#F0E8D7", "#302820", "#17633D", "#FFFFFF"].includes(c)), [], "только цвета оформления и акцент");
  for (const kind of ["stake", "content", "recap"] as const) {
    const html = buildDeckHtml({ ...deckCarousel, slide: slide({ kind, bullets: ["Один", "Два", "Три"] }), index: 2, total: 8, scale: 1, fontCss: "", channel: CHANNEL });
    assert.match(html, new RegExp(`kind-${kind}`));
    assert.match(html, />3\/8</);
    assert.doesNotMatch(html, /class="qr"/);
  }
  // итог — карточка для скриншота: только заголовок и список
  assert.doesNotMatch(buildDeckHtml({ ...deckCarousel, slide: slide({ kind: "recap", bullets: ["Один", "Два", "Три"] }), index: 6, total: 8, scale: 1, fontCss: "" }), /class="meta"/);
  // без подключённого аккаунта — без аватарки (не инициалы), без ника — без шапки
  const noAvatar = buildDeckHtml({ ...deckCarousel, slide: slide(), index: 2, total: 8, scale: 1, fontCss: "" });
  assert.doesNotMatch(noAvatar, /class="ava"/);
  assert.match(noAvatar, /class="nm"[^>]*>owner\.alex</);
  assert.doesNotMatch(buildDeckHtml({ ...deckCarousel, design: { ...deckDesignFixture, igHandle: undefined }, slide: slide(), index: 2, total: 8, scale: 1, fontCss: "" }), /class="who"/);
});

test("шаблон скилла: финал — строка про канал и крупный QR с белым полем, без шапки и кнопки", () => {
  const final = buildDeckHtml({ ...deckCarousel, slide: slide({ kind: "final", title: "Новые токены разбираю **в Telegram**", body: "", cta: "" }), index: 7, total: 8, scale: 1, fontCss: "", avatarDataUrl: "data:image/jpeg;base64,AAAA", channel: CHANNEL });
  assert.match(final, /<span class="hl">в\sTelegram<\/span>/);
  assert.match(final, /class="chan"[^>]*><div class="pl">Telegram-канал<\/div><div>Алексей Гудов \| FX GOLD<\/div>/);
  assert.doesNotMatch(final, /class="who"|class="cta"|owner_crypto/);
  // 29 модулей + поле 4 модуля с каждой стороны, модуль 14 px: 518 px, сам код — 406 px
  const n = CHANNEL.qr.length;
  assert.match(final, new RegExp(`<svg class="qr" width="${(n + 8) * 14}" height="${(n + 8) * 14}" viewBox="0 0 ${n + 8} ${n + 8}" shape-rendering="crispEdges"`));
  assert.ok(n * 14 >= 400);
  const dark = CHANNEL.qr.join("").split("").filter((x) => x === "1").length;
  assert.equal((qrSvg(CHANNEL.qr, 14).match(/h1v1h-1z/g) ?? []).length, dark, "каждый тёмный модуль — квадрат");
});

test("канал для финала — копия studio3d/src/channel.json: ссылка-приглашение и матрица QR", () => {
  assert.ok(TELEGRAM_CHANNEL);
  assert.equal(channelTitle(TELEGRAM_CHANNEL!), "Алексей Гудов | FX GOLD");
  assert.match(TELEGRAM_CHANNEL!.url, /^https:\/\/t\.me\/\+/);
  const source = path.join(__dirname, "..", "studio3d", "src", "channel.json");
  // источник есть в полной рабочей копии: копия должна совпадать с ним
  if (fs.existsSync(source)) assert.deepEqual(JSON.parse(fs.readFileSync(source, "utf8")), JSON.parse(fs.readFileSync(path.join(__dirname, "..", "lib", "carousel", "telegramChannel.json"), "utf8")));
});

test("отпечаток карточки скилла меняется от текста, позиции, числа слайдов, оформления, ника и аватарки", () => {
  const h = deckHash(deckCarousel, slide(), 2, 8, CHANNEL);
  assert.equal(deckHash(deckCarousel, slide(), 2, 8, CHANNEL), h);
  assert.notEqual(deckHash(deckCarousel, slide({ body: "Другой" }), 2, 8, CHANNEL), h);
  assert.notEqual(deckHash(deckCarousel, slide(), 3, 8, CHANNEL), h);
  assert.notEqual(deckHash(deckCarousel, slide(), 2, 9, CHANNEL), h);
  assert.notEqual(deckHash({ ...deckCarousel, design: { ...deckDesignFixture, accent: "#000000" } }, slide(), 2, 8, CHANNEL), h);
  assert.notEqual(deckHash({ ...deckCarousel, design: { ...deckDesignFixture, igHandle: "other" } }, slide(), 2, 8, CHANNEL), h);
  assert.notEqual(deckHash({ ...deckCarousel, design: { ...deckDesignFixture, avatarFile: "avatar-fedcba9876543210.png" } }, slide(), 2, 8, CHANNEL), h);
  // сменилась ссылка канала — финал пересобирается, остальные карточки — нет
  const final = slide({ kind: "final" });
  assert.notEqual(deckHash(deckCarousel, final, 7, 8, CHANNEL), deckHash(deckCarousel, final, 7, 8, { ...CHANNEL, url: "https://t.me/+other" }));
  assert.equal(deckHash(deckCarousel, slide(), 2, 8, { ...CHANNEL, url: "https://t.me/+other" }), h);
  const c = { schema: 3 as const, mode: "text_cards" as const, style: "graphite" as const, footer: "", ...deckCarousel };
  assert.equal(slideContentHash(c, slide(), 2, 8), deckHash(deckCarousel, slide(), 2, 8, TELEGRAM_CHANNEL));
  assert.equal(slideContentHash({ ...c, schema: 2 }, slide(), 2, 8), slideHash(c, slide(), 2, 8));
});

test("скилл: alt text — текст карточки, на финале — ещё и QR канала", () => {
  assert.equal(deckAltText(slide({ kind: "recap", title: "**Коротко**", body: "", bullets: ["Режим", "Свет."] })), "Коротко. Режим. Свет.");
  assert.equal(deckAltText(slide({ kind: "final", title: "Разборы — в Telegram", body: "", bullets: [] }), CHANNEL), "Разборы — в Telegram. QR-код для входа в Telegram-канал «Алексей Гудов | FX GOLD».");
  assert.equal(deckKindAt(1, 6), "stake");
  assert.equal(deckKindAt(4, 6), "recap");
  assert.equal(wordCount("Больше проверок — в Telegram"), 4);
});

test("скилл: ручные правки — не больше пяти хэштегов, переставлять можно только мысли", () => {
  const slides = normalizeDraft(deckPlan(), { deck: DECK }).draft.slides.map((s, i) => ({ ...s, id: `sid00000000000${i}` })) as Slide[];
  const make = () => ({ schema: 3, mode: "text_cards", revision: 1, title: "t", caption: "c", hashtags: [], footer: "", style: "graphite", format: "portrait", language: "ru", design: deckDesignFixture, slides: structuredClone(slides) }) as any;
  assert.throws(() => applyManualEdit(make(), { revision: 1, hashtags: "#a #b #c #d #e #f" }), /не больше 5/);
  const ok = make();
  applyManualEdit(ok, { revision: 1, hashtags: "#сон, привычки" });
  assert.deepEqual(ok.hashtags, ["#сон", "#привычки"]);
  const ids = slides.map((s) => s.id);
  const swapIdeas = [ids[0], ids[1], ids[3], ids[2], ...ids.slice(4)];
  assert.doesNotThrow(() => applyManualEdit(make(), { revision: 1, order: swapIdeas }));
  const recapFirst = [ids[0], ids[6], ...ids.slice(2, 6), ids[1], ids[7]];
  assert.throws(() => applyManualEdit(make(), { revision: 1, order: recapFirst }), /только мысли/);
});
