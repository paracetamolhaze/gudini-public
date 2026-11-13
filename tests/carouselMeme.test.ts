import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCreateRequest } from "../lib/carousel/request";
import { MEME_CAST, MEME_CHECK_RULES, MEME_DIRECTOR_RULES, MEME_TRENDS_RULES, applyDirector, normalizeMemeTrends, memeCheckUser, parseMemeCheck, artTextKey, autoMemeIdea, buildMemeCardHtml, buildMemeHtml, memeDesign, memeLine, MEME_ART_STYLE, MEME_IDEAS_RULES, MEME_NICHE, MEME_PICK_RULES, nextMemeCategory } from "../lib/carousel/meme";
import { usedMemeJokes, writePlan, writeSlide } from "../lib/carousel/writer";
import { createCarousel } from "../lib/carousel/store";
import { memeTaste, rememberRating } from "../lib/carousel/memeTaste";
import { memeCandidateCount } from "../lib/carousel/prompt";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_DESIGN } from "../lib/carousel/designShared";
import { designKey } from "../lib/carousel/illustrated";
import { generationSystem, generationUser, normalizeDraft, normalizeRegenerated } from "../lib/carousel/prompt";
import { buildEditPrompt, buildImagePrompt } from "../lib/carousel/imagePrompt";
import { paintedTextKey } from "../lib/carousel/painted";

const account = { ...DEFAULT_DESIGN, artworkMode: "painted" as const, author: "TG:@owner_crypto", characterDescription: "Blond hero in a navy hoodie", referenceFile: "reference-x.png", portraitFile: "portrait-x.jpg" };
const meme = memeDesign(account);
const req = { idea: "Жизнь криптана в медвежий рынок", wishes: "", slideCount: 5, language: "ru" as const, style: "graphite" as const, format: "portrait" as const, genre: "meme" as const };
const image = { brief: "An enlightened sage in lotus pose stares in horror at a phone with a steep red falling chart", composition: "sage in the middle", textPlacement: "top" };

test("the create form chooses the style; old requests stay expert", () => {
  const made = parseCreateRequest({ idea: "Жизнь криптана", genre: "meme" }, { imageModel: "codex/imagegen" });
  assert.ok(!("error" in made) && made.request.genre === "meme");
  const plain = parseCreateRequest({ idea: "Жизнь криптана" }, { imageModel: "codex/imagegen" });
  assert.ok(!("error" in plain) && plain.request.genre === "expert");
  assert.ok("error" in parseCreateRequest({ idea: "Жизнь криптана", genre: "roast" }, { imageModel: "codex/imagegen" }));
});

test("memes are made with one button: one category per carousel, taken in turn", () => {
  const auto = parseCreateRequest({ genre: "meme", idea: "  " }, { imageModel: "codex/imagegen", memeCategory: () => "crypto" });
  assert.ok(!("error" in auto) && auto.request.memeCategory === "crypto" && auto.request.idea === autoMemeIdea("crypto"));
  assert.match(autoMemeIdea("crypto"), /^Мемы про крипту: монеты и мемкоины/);
  const chosen = parseCreateRequest({ genre: "meme", memeCategory: "streams" }, { imageModel: "codex/imagegen", memeCategory: () => "crypto" });
  assert.ok(!("error" in chosen) && chosen.request.memeCategory === "streams");
  // своя тема без категории: категория та, к которой относится тема
  const typed = parseCreateRequest({ genre: "meme", idea: "Донаты на стриме" }, { imageModel: "codex/imagegen", memeCategory: () => "crypto" });
  assert.ok(!("error" in typed) && typed.request.memeCategory === undefined);
  assert.ok("error" in parseCreateRequest({ genre: "meme", memeCategory: "politics" }, { imageModel: "codex/imagegen" }));
  // экспертной карусели тема по-прежнему нужна
  assert.ok("error" in parseCreateRequest({ idea: "" }, { imageModel: "codex/imagegen" }));
  const made = (memeCategory?: string) => ({ request: { genre: "meme", memeCategory } }) as any;
  assert.equal(nextMemeCategory([]), "trading");
  assert.equal(nextMemeCategory([made("trading")]), "crypto");
  assert.equal(nextMemeCategory([made("crypto"), made("trading"), made("earning"), made("streams")]), "streams");
  assert.equal(nextMemeCategory([made("streams"), made(), made("earning"), made("crypto"), made("trading")]), "trading");
});

test("every meme stays in the account's niche and skips jokes that were already out", () => {
  const user = generationUser({ ...req, idea: autoMemeIdea("trading"), memeCategory: "trading" }, { illustrated: true, design: meme, now: new Date("2026-09-30T08:00:00Z"), usedJokes: ["Я: просто проверю портфель перед сном / Сон покинул чат"] });
  assert.match(user, /День недели: среда/);
  assert.ok(user.includes(MEME_NICHE));
  assert.match(user, /Категория карусели: трейдинг \(сделки, плечи/);
  assert.match(generationUser(req, { illustrated: true, design: meme }), /Вся карусель — в одной категории/);
  assert.match(user, /уже выходили[\s\S]*- Я: просто проверю портфель перед сном \/ Сон покинул чат/);
  const slide = (title: string, body = "") => ({ title, body }) as any;
  const list = [
    { id: "c-now", design: meme, slides: [slide("Текущая")] },
    { id: "c-expert", design: account, slides: [slide("Почему я покупаю ETH")] },
    { id: "c-old", design: meme, slides: [slide("Когда купил дно, а оно поехало дальше"), slide("Ты трейдер или инвестор?", "Смотря насколько я в минусе")] },
  ] as any;
  assert.deepEqual(usedMemeJokes("c-now", list), ["Когда купил дно, а оно поехало дальше", "Ты трейдер или инвестор? / Смотря насколько я в минусе"]);
});

test("a meme carousel is painted whole: the author is the hero, the expert style reference stays out", () => {
  assert.equal(meme.genre, "meme");
  assert.equal(meme.artworkMode, "painted");
  assert.equal(meme.author, "TG:@owner_crypto");
  assert.equal(meme.illustrationStyle, MEME_ART_STYLE);
  assert.equal(meme.characterDescription, MEME_CAST);
  assert.match(MEME_CAST, /Lukashenko/);
  assert.equal(meme.referenceFile, undefined);
  assert.equal(meme.portraitFile, "portrait-x.jpg");
  // готовые карточки прежних карусель не устаревают из-за нового поля
  assert.equal(designKey(DEFAULT_DESIGN), JSON.stringify([DEFAULT_DESIGN.accent, DEFAULT_DESIGN.textColor, DEFAULT_DESIGN.scrimColor, DEFAULT_DESIGN.titleFont, DEFAULT_DESIGN.author, null, "overlay"]));
  assert.notEqual(designKey(meme), designKey({ ...meme, genre: undefined }));
});

test("the writer receives meme rules instead of the expert scenario", () => {
  const system = generationSystem(true, meme);
  assert.match(system, /самостоятельных мемов/);
  assert.match(system, /Какой слайд про тебя/);
  assert.match(system, /Планка — референс автора @lankad\.om/);
  assert.match(system, /шутит изнутри над языком и верованиями своей ниши/);
  assert.match(system, /Язык нашей ниши — трейдинг и крипта/);
  assert.doesNotMatch(system, /экспертных каруселей|impasto|navy hoodie/);
  assert.match(system, /Главный герой каждого мема — автор аккаунта/);
  const user = generationUser(req, { illustrated: true, design: meme });
  assert.match(user, /Мемов: ровно 5/);
  assert.match(user, /пузыри с текстом/);
});

test("dialogue dashes disappear: the bubble tail shows who is speaking", () => {
  assert.equal(memeLine("— Ты трейдер или долгосрочный инвестор?"), "Ты трейдер или долгосрочный инвестор?");
  assert.equal(memeLine("- Смотря насколько я в минусе"), "Смотря насколько я в минусе");
  assert.equal(memeLine("Медитация — это легко"), "Медитация - это легко");
  assert.equal(memeLine("Ещё–ещё"), "Ещё-ещё");
  const scene = (brief: string) => ({ ...image, brief });
  const slides = [
    { kind: "cover", title: "— Ты трейдер или инвестор?", body: "— Смотря насколько я в минусе", image },
    { kind: "content", title: "Я: покупаю «на всё» на хаях", body: "Рынок через 5 минут:", image: scene("A golden bull statue crumbles into sand, a merchant watches in horror") },
    { kind: "final", title: "Криптан в 3 часа ночи смотрит на свечи", body: "", image: scene("A man in a nightcap lit by a phone showing red candles in a dark bedroom") },
  ];
  const parsed = normalizeDraft({ slides, caption: "Какой слайд про тебя? 👇", hashtags: ["#крипта"], visual: { style: MEME_ART_STYLE } }, { expectedCount: 3, illustrated: true, meme: true });
  assert.deepEqual(parsed.fatal, []);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.draft.slides[0].title, "Ты трейдер или инвестор?");
  assert.equal(parsed.draft.slides[0].body, "Смотря насколько я в минусе");
  const long = normalizeDraft({ slides: slides.map((s) => ({ ...s, title: "очень ".repeat(20) })), caption: "x", hashtags: [] }, { illustrated: true, meme: true });
  assert.match(long.problems.join("\n"), /title \d+ символов при пределе 90/);
  const one = normalizeRegenerated({ slide: { title: "— Когда", body: "", bullets: ["Я не тебе", "четвёртый лишний"], kicker: "метка", image } }, { slides: slides as any }, 1, true, true);
  assert.equal(one.slide.title, "Когда");
  assert.match(one.problems.join(), /не больше трёх текстов/);
  assert.match(one.problems.join(), /kicker и cta пустые/);
});

test("the generator paints the bubbles with the exact text and screens show a chart", () => {
  const slide = { kind: "content" as const, title: "Я: покупаю на хаях", body: "Рынок через 5 минут:", image: { ...image, textPlacement: "top" as const, versions: [], rev: 0, status: "none" as const, attempts: 0 } };
  const prompt = buildImagePrompt({ visual: undefined, design: meme, slide, index: 1, total: 5, format: "portrait", refs: { anchor: true, account: false } });
  assert.match(prompt, /Text 1: Я: ПОКУПАЮ НА ХАЯХ$/m);
  assert.match(prompt, /Text 2: РЫНОК ЧЕРЕЗ 5 МИНУТ:$/m);
  assert.match(prompt, /pointed tail aimed at that character's mouth/);
  assert.match(prompt, /steep red falling price chart/);
  assert.match(prompt, /over the person.s shoulder/);
  assert.match(prompt, /repeat its cartouche design and lettering font/);
  assert.match(prompt, /Museum-quality classical oil painting/);
  const withPortrait = buildImagePrompt({ visual: undefined, design: meme, slide, index: 1, total: 5, format: "portrait", refs: { anchor: true, account: false, portrait: true } });
  assert.match(withPortrait, /photo of Hero[\s\S]*Keep his likeness/);
  assert.doesNotMatch(withPortrait, /navy blue hoodie|cartoon facial proportions/);
  assert.doesNotMatch(prompt, /Do not draw any text|impasto|Warm ivory|owner_crypto/);
  const edit = buildEditPrompt({ instruction: "Сделай лицо испуганнее", slide, visual: undefined, hasAnchor: false, design: meme, index: 1, total: 5 });
  assert.match(edit, /Text 1: Я: ПОКУПАЮ НА ХАЯХ$/m);
  assert.match(edit, /Preserve the painted lettering style/);
});

test("a text change needs a new picture; moving the slide or the signature does not", () => {
  const slide = { title: "Я: покупаю на хаях", body: "Рынок через 5 минут:" };
  const key = artTextKey(slide, meme, 1, 5);
  assert.equal(artTextKey(slide, meme, 3, 6), key);
  assert.equal(artTextKey(slide, { ...meme, author: "@other" }, 1, 5), key);
  assert.notEqual(artTextKey({ ...slide, body: "Рынок через минуту:" }, meme, 1, 5), key);
  // экспертный стиль с живописными надписями считает отпечаток по-прежнему
  assert.equal(artTextKey(slide, account, 1, 5), paintedTextKey(slide, account, 1, 5));
});

test("the finished meme is the painted picture plus the author's label", () => {
  const html = buildMemeCardHtml({ format: "portrait", design: { ...meme, author: "TG:<@owner_crypto>" }, fontCss: "", artDataUrl: "data:image/png;base64,AA==" });
  assert.match(html, /class="handle"[^>]*>TG:&lt;@owner_crypto&gt;</);
  assert.doesNotMatch(html, /class="content/);
  // первые мем-карусели с плашками поверх картинки собираются как раньше
  const legacy = buildMemeHtml({ format: "portrait", language: "ru", design: { ...meme, artworkMode: "overlay" }, slide: { title: "Я: <script>", body: "Рынок" }, scale: 1, fontCss: "", artDataUrl: "data:image/png;base64,AA==" });
  assert.match(legacy, /&lt;script&gt;/);
  assert.match(legacy, /class="content bottom"/);
});

test("jokes are picked by a strict editor from three times more candidates before the scenario", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "carousel-meme-"));
  const saved = { ...process.env };
  process.env.CAROUSEL_DATA_DIR = root;
  process.env.CAROUSEL_TEXT_MODEL = "gpt-6-astra";
  process.env.CAROUSEL_MONTHLY_BUDGET_USD = "0";
  process.env.CAROUSEL_MAX_COST_PER_CAROUSEL_USD = "0";
  delete process.env.CAROUSEL_OPENROUTER_API_KEY;
  process.env.CODEX_BRIDGE_TOKEN = "test-token";
  const candidates = Array.from({ length: 9 }, (_, i) => ({ truth: `правда ${i + 1}`, title: `— Шутка ${i + 1}`, body: i ? `Развязка ${i + 1}` : "", scene: `Сцена ${i + 1}` }));
  const picked = [{ n: 7, title: "Шутка 7, но переписанная", why: "смешно" }, { n: 2, why: "жизненно" }, { n: 99 }];
  const kinds = ["cover", "content", "final"];
  const trends = { memes: [{ original: "Это была долгая неделя — Сегодня только среда — Блядь..", why: "боль, знакомая каждому, и честная реакция одним словом", adaptation: "неделя трейдера: минус с понедельника, а сегодня только вторник", source: "https://example.org/meme" }] };
  const draft = { title: "Трейдинг: неделя", story: ["1", "2", "3"], visual: { style: MEME_ART_STYLE }, caption: "Какой слайд про тебя? 👇", hashtags: ["#трейдинг"], claimsToCheck: [], slides: kinds.map((kind, i) => ({ kind, title: `Мем ${i + 1}`, body: "", image: { brief: ["A trader at his own desk stares at a red chart on his monitor", "A grandmother at a dinner table asks her grandson about his coins", "A sleepy man in bed checks candles on his phone at night"][i], composition: "one character in the center", textPlacement: "top" } })) };
  const requests: any[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    const out = body.system === MEME_TRENDS_RULES ? trends : body.system === MEME_IDEAS_RULES ? { candidates } : body.system === MEME_PICK_RULES ? { picked } : body.system === MEME_DIRECTOR_RULES ? { slides: [{ n: 1, brief: "Directed: Hero sits facing his own monitor, the red chart on it", composition: "over-the-shoulder shot" }] } : draft;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ text: JSON.stringify(out), usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, runId: "run", durationMs: 1 }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.CODEX_BRIDGE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const parsed = parseCreateRequest({ genre: "meme", slideCount: 3 }, { imageModel: "codex/imagegen", memeCategory: () => "trading" });
    assert.ok(!("error" in parsed));
    const c = createCarousel(parsed.request, { mode: "illustrated", design: meme, imageModel: "codex/imagegen" });
    rememberRating(c, { id: "s000000000009", kind: "content", kicker: "", title: "Какие свечи тебе на торт поставить?", body: "Только не красные, блядь.", bullets: [], cta: "" } as any, "up");
    const plan = await writePlan(c, "job-meme");
    assert.equal(plan.draft.slides.length, 3);
    assert.equal(plan.research, undefined);
    const stepOf = (r: any) => (r.system === MEME_TRENDS_RULES ? "trends" : r.system === MEME_IDEAS_RULES ? "ideas" : r.system === MEME_PICK_RULES ? "pick" : r.system === MEME_DIRECTOR_RULES ? "director" : "plan");
    assert.deepEqual(requests.map(stepOf), ["trends", "ideas", "pick", "plan", "director"]);
    const [trendReq, ideasReq, pickReq, planReq] = requests;
    assert.equal(trendReq.webSearch, "live");
    assert.match(ideasReq.user, /Залетевшие мемы от мемолога[\s\S]*Сегодня только среда/);
    assert.match(pickReq.user, /Автор отметил 👍[\s\S]*Только не красные, блядь/);
    assert.equal(plan.draft.slides[0].image?.brief, "Directed: Hero sits facing his own monitor, the red chart on it");
    assert.ok(ideasReq.user.includes(`Кандидатов: ровно ${memeCandidateCount(3)}.`));
    assert.match(ideasReq.user, /Категория карусели: трейдинг/);
    assert.match(pickReq.user, /7\) Шутка 7 \/ Развязка 7 — сцена: Сцена 7/);
    // повторная подборка в пределах 12 часов берёт находки мемолога из кэша
    const before = requests.length;
    await writePlan(c, "job-meme-2");
    assert.ok(!requests.slice(before).some((r) => r.system === MEME_TRENDS_RULES));
    assert.match(planReq.user, /выбрал редактор[\s\S]*1\) Шутка 7 \/ Развязка 7 — сцена: Сцена 7\n2\) Шутка 2 \/ Развязка 2 — сцена: Сцена 2\n3\) Шутка 1 — сцена: Сцена 1/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a three-beat meme keeps its third text on any slide and paints it", () => {
  const slides = [
    { kind: "cover", title: "У меня ипотека, отпусти меня, умоляю", body: "Не отпущу", bullets: ["— Я не тебе"], image },
    { kind: "final", title: "Какие свечи тебе на торт поставить?", body: "Только не красные, бл*дь", bullets: [], image: { ...image, brief: "A birthday party where a grumpy trader stares at the cake candles" } },
  ];
  const parsed = normalizeDraft({ slides, caption: "Какой слайд про тебя? 👇", hashtags: ["#трейдинг"], visual: { style: MEME_ART_STYLE } }, { illustrated: true, meme: true });
  assert.deepEqual(parsed.draft.slides[0].bullets, ["Я не тебе"]);
  assert.deepEqual(parsed.problems, []);
  const slide = { title: "У меня ипотека, отпусти меня, умоляю", body: "Не отпущу", bullets: ["Я не тебе"] };
  const prompt = buildImagePrompt({ visual: undefined, design: meme, slide: { ...slide, kind: "cover" as const, image: { ...image, textPlacement: "top" as const, versions: [], rev: 0, status: "none" as const, attempts: 0 } }, index: 0, total: 5, format: "portrait", refs: { anchor: false, account: false } });
  assert.match(prompt, /Text 3: Я НЕ ТЕБЕ$/m);
  assert.notEqual(artTextKey(slide, meme, 0, 5), artTextKey({ ...slide, bullets: [] }, meme, 0, 5));
});

test("a new joke for one slide also goes through candidates and the editor, skipping the rejected one", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "carousel-meme-slide-"));
  const saved = { ...process.env };
  process.env.CAROUSEL_DATA_DIR = root;
  process.env.CAROUSEL_TEXT_MODEL = "gpt-6-astra";
  process.env.CAROUSEL_MONTHLY_BUDGET_USD = "0";
  process.env.CAROUSEL_MAX_COST_PER_CAROUSEL_USD = "0";
  delete process.env.CAROUSEL_OPENROUTER_API_KEY;
  process.env.CODEX_BRIDGE_TOKEN = "test-token";
  const candidates = [
    { format: "Вопрос и ответ", texts: ["Вам счёт?", "Мне бы свой вернуть."], scene: "Lukashenko as a waiter brings the bill to Hero" },
    { format: "Вопрос и ответ", texts: ["Как стрижём?", "Под ноль. Я привык."], scene: "Lukashenko as a barber, Hero in the chair with a phone" },
  ];
  const requests: any[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    const out = body.system === MEME_IDEAS_RULES ? { candidates } : body.system === MEME_PICK_RULES ? { picked: [{ n: 2, why: "жизненно" }] } : { slide: { kind: "content", title: "Как стрижём?", body: "Под ноль. Я привык.", image: { brief: "Lukashenko as a barber trims Hero, who stares at a red chart on his phone", composition: "barber behind the chair", textPlacement: "top" } }, claimsToCheck: [] };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ text: JSON.stringify(out), usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, runId: "run", durationMs: 1 }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.CODEX_BRIDGE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const parsed = parseCreateRequest({ genre: "meme", memeCategory: "trading", slideCount: 3 }, { imageModel: "codex/imagegen" });
    assert.ok(!("error" in parsed));
    const c = createCarousel(parsed.request, { mode: "illustrated", design: meme, imageModel: "codex/imagegen" });
    const img = (brief: string) => ({ brief, composition: "", textPlacement: "top" as const, versions: [], rev: 0, status: "none" as const, attempts: 0 });
    c.slides = [
      { id: "s000000000001", kind: "cover", kicker: "", title: "Вам капли или свечи?", body: "Капли. Свечи у меня уже в жопе.", bullets: [], cta: "", image: img("Lukashenko as a pharmacist") },
      { id: "s000000000002", kind: "content", kicker: "", title: "Можно наркоз посильнее?", body: "Так мы уже закончили.", bullets: ["А у меня сделка ещё идёт."], cta: "", image: img("Lukashenko as a dentist") },
      { id: "s000000000003", kind: "final", kicker: "", title: "Взял себя в руки после убытка.", body: "", bullets: [], cta: "", image: img("Hero holds a tiny crying Hero") },
    ] as any;
    const r = await writeSlide(c, 1, "жёстче", "job-slide");
    assert.equal(r.slide.title, "Как стрижём?");
    const stepOf = (q: any) => (q.system === MEME_TRENDS_RULES ? "trends" : q.system === MEME_IDEAS_RULES ? "ideas" : q.system === MEME_PICK_RULES ? "pick" : q.system === MEME_DIRECTOR_RULES ? "director" : "slide");
    assert.deepEqual(requests.map(stepOf), ["trends", "ideas", "pick", "slide", "director"]);
    const ideasReq = requests[1];
    assert.match(ideasReq.user, /Кандидатов: ровно 10\./);
    assert.match(ideasReq.user, /Пожелание автора к этому слайду: жёстче/);
    assert.match(ideasReq.user, /Можно наркоз посильнее\? \/ Так мы уже закончили\. \/ А у меня сделка ещё идёт\./);
    assert.match(requests[3].user, /Новую шутку для этой карточки выбрал редактор[\s\S]*Как стрижём\? \/ Под ноль, я привык/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the picture check reads the editor's verdict and knows the exact texts", () => {
  assert.deepEqual(parseMemeCheck({ ok: false, problems: ["the man has a third hand holding the phone, remove it"] }), { ok: false, problems: ["the man has a third hand holding the phone, remove it"] });
  assert.deepEqual(parseMemeCheck({ ok: true, problems: [] }), { ok: true, problems: [] });
  // сломанный ответ не блокирует картинку
  assert.equal(parseMemeCheck(null).ok, true);
  const user = memeCheckUser({ title: "Можно наркоз посильнее?", body: "Так мы уже закончили.", bullets: ["Я не про зуб."] });
  assert.match(user, /Text 3: Я НЕ ПРО ЗУБ$/m);
  assert.match(MEME_CHECK_RULES, /не больше двух рук/);
});

test("the meme-scout keeps only sourced events; the director only restages scenes; taste favours fresh ratings", () => {
  const t = normalizeMemeTrends({ memes: [{ original: "Ты — лучшее, что было в моей жизни! — Пиздец, у тебя жизнь...", why: "разворот комплимента", adaptation: "Hero и его депозит", source: "https://example.org/a" }, { original: "мем без источника", why: "", adaptation: "", source: "" }] });
  assert.equal(t.memes.length, 1);
  assert.equal(t.memes[0].adaptation, "Hero и его депозит");
  const slides = [{ title: "Вам счёт?", body: "Мне бы свой вернуть.", bullets: [], image: { brief: "Lukashenko as a waiter brings the bill", composition: "", textPlacement: "top" as const } }];
  const directed = applyDirector(slides, { slides: [{ n: 1, brief: "Lukashenko as a waiter hands the bill to Hero, who looks at a red chart on his phone", composition: "two-shot at the table" }] });
  assert.equal(directed[0].title, "Вам счёт?");
  assert.match(directed[0].image!.brief, /hands the bill to Hero/);
  // пустой или короткий ответ режиссёра постановку не ломает
  assert.equal(applyDirector(slides, { slides: [{ n: 1, brief: "ok" }] })[0].image!.brief, "Lukashenko as a waiter brings the bill");
  const taste = memeTaste([
    { key: "a", value: "up", texts: "Старая шутка", at: "2026-09-29T10:00:00Z" },
    { key: "b", value: "down", texts: "Детская развязка", at: "2026-09-30T10:00:00Z" },
    { key: "c", value: "up", texts: "Свежая шутка", at: "2026-09-30T11:00:00Z" },
  ]);
  assert.deepEqual(taste, { liked: ["Свежая шутка", "Старая шутка"], disliked: ["Детская развязка"] });
});
