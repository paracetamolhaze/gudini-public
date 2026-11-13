import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import sharp from "sharp";
import { DEFAULT_STYLE, isStyleId, STYLES } from "../lib/carousel/styles/catalog";
import { captionSentences, parseStyled, parseStyledResearch, shown, styledProblems, urgentStaleness } from "../lib/carousel/styles/validate";
import { marks } from "../lib/carousel/styles/html";

/**
 * Выбор стиля в кнопке «Создать» (владелец 01.11): семь стилей, проверка текстов каждого стиля на образцах,
 * одобренных владельцем, и весь конвейер «Срочно» и «Рынка» без сети — поддельные мосты Claude и картинок,
 * настоящий Chromium и вёрстка.
 */

const SRC = [{ url: "https://247wallst.com/a", title: "A", publisher: "24/7 Wall St.", date: "2026-10-31" }];
const urgent = () => ({
  topic: "Из биткоин-ETF вывели $643 млн за день", topicKey: "btc-etf-643",
  slides: [
    { text: "30 октября из биткоин-ETF в США [r]вывели $643 млн[/r] за один день. Больше всех потерял [r]фонд BlackRock: $233,7 млн[/r].", sub: "Худший день с 25 июня", scene: "A trader on the NYSE floor." },
    { text: "Из фонда BlackRock за день ушло [r]$233,7 млн[/r]. Но за весь октябрь в него всё равно пришло [g]$932,1 млн[/g].", sub: "Остальным повезло меньше", scene: "Another trader." },
    { text: "Следом [r]Fidelity: $201 млн[/r] и [r]ARK: $129,5 млн[/r]. В тот день ни один биткоин-ETF не получил ни доллара.", sub: "Итог октября: −$515 млн", scene: "Traders at a booth." },
  ],
  caption: "30 октября из биткоин-ETF вывели $643 млн. Больше всех потерял BlackRock.\nКрупные игроки уходят? Пиши в комментариях.",
  sources: SRC,
});
const market = () => ({
  topic: "Красный октябрь для акций крипты", topicKey: "red-october",
  cover: { title: "Красный октябрь", rows: [["Coinbase", "−26%", "за октябрь"], ["Robinhood", "−29%", "за месяц"], ["Strategy", "−12%", "за день, 30 октября"], ["Circle", "−9%", "за день, 30 октября"], ["Майнеры", "до −31%", "за неделю"], ["Gemini", "−89%", "от цены IPO"]], cta: "Листай: что с каждой →", scene: "A trader at monitors." },
  slides: [
    { text: "прибыль [b]Coinbase[/b] за квартал [g]$719 млн[/g], но [r]$715 млн[/r] из них дала переоценка крипты", scene: "An analyst desk." },
    { text: "[b]Robinhood[/b] за месяц [r]−29%[/r], до [g]$82,72[/g]. криптовыручка за квартал упала на [r]55%[/r]", scene: "A man on the subway with a phone." },
    { text: "[b]Strategy[/b] сама продала биткоин на [r]$432 млн[/r]. 30 октября акция [r]−12%[/r], до [g]$125,25[/g]", scene: "Traders at a booth." },
    { text: "[y]биткоин[/y] за октябрь [r]−7,1%[/r]. [b]Coinbase[/b] [r]−26%[/r]. кому веришь: монете или акциям?", scene: "A tired trader." },
  ],
  caption: "В октябре акции Coinbase потеряли 26%, а биткоин 7,1%. Strategy продавала биткоин.\nКому веришь больше? Пиши в комментариях.",
  sources: SRC,
});
const research = (key: string) => ({ topic: "История", topicKey: key, angle: "что известно", facts: Array.from({ length: 6 }, (_, i) => ({ id: `f${i + 1}`, claim: `Факт ${i + 1}`, quote: `Quote ${i + 1}`, url: `https://247wallst.com/a${i}`, publisher: "24/7 Wall St.", date: "2026-10-31" })), pages: [{ url: "https://247wallst.com/a0", publisher: "24/7 Wall St.", headline: "A" }], extra: {} });

test("каталог: семь стилей с понятными названиями, по умолчанию прежнее «Расследование»", () => {
  assert.deepEqual(STYLES.map((s) => s.name), ["Расследование", "Срочно", "Подборка", "Рынок", "Мульт", "Кино", "Разбор"]);
  assert.equal(DEFAULT_STYLE, "investigation");
  assert.ok(STYLES.every((s) => s.blurb.length > 20 && !/—/.test(s.blurb)));
  assert.ok(isStyleId("cartoon") && !isStyleId("memes") && !isStyleId(undefined));
  for (const s of STYLES) assert.ok(fs.existsSync(path.join("lib/carousel/styles/thumbs", `${s.id}.jpg`)), `нет миниатюры ${s.id}`);
});

test("тексты образцов проходят проверку; длинное тире, лишние знаки и обложка без сводки ловятся", () => {
  assert.deepEqual(styledProblems("urgent", parseStyled("urgent", urgent())), []);
  assert.deepEqual(styledProblems("market", parseStyled("market", market())), []);
  const bad = urgent();
  bad.slides[1].sub = "Итог — минус";
  bad.caption = "Без вопроса.";
  const p = styledProblems("urgent", parseStyled("urgent", bad));
  assert.ok(p.some((x) => x.startsWith("slides[1].sub: длинное тире")), p.join("\n"));
  assert.ok(p.some((x) => x.startsWith("caption: нужен вопрос")), p.join("\n"));
  const thin = market();
  thin.cover.rows = thin.cover.rows.slice(0, 2);
  assert.ok(styledProblems("market", parseStyled("market", thin)).some((x) => x.startsWith("cover.rows:")));
  assert.throws(() => parseStyled("urgent", { ...urgent(), slides: urgent().slides.slice(0, 2) }), /Нужно 3 слайда/);
  assert.equal(shown("[r]$643 млн[/r] **за день**"), 16);
  assert.throws(() => parseStyledResearch({ topic: "x", topicKey: "x", facts: [] }), /мало фактов/);
});

test("разметка цвета: [r]…[/r] в цвет, число не отрывается от «млн», слово с дефисом не рвётся", () => {
  const html = marks("вывели [r]$643 млн[/r] из биткоин-ETF");
  assert.match(html, /<span class="c-r">\$643 млн<\/span>/);
  assert.match(html, /<span style="white-space:nowrap">биткоин-ETF<\/span>/);
});

let server: http.Server;
let base = "";
const calls: string[] = [];
let mode: "urgent" | "market" = "urgent";
const imageJobs: any[] = [];
let schemeAnswers: string[] = [];

before(async () => {
  const png = await sharp({ create: { width: 1024, height: 1280, channels: 3, background: "#404040" } }).png().toBuffer();
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const send = (body: unknown) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
      if (req.url === "/image") { calls.push("image"); imageJobs.push(JSON.parse(Buffer.concat(chunks).toString("utf8"))); return send({ base64: png.toString("base64"), mediaType: "image/png", runId: "r1", billing: "subscription" }); }
      if (req.url === "/complete") {
        const job = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        calls.push(job.label);
        const content = mode === "urgent" ? urgent() : market();
        if (/тема и факты/.test(job.label)) return send({ text: JSON.stringify({ ...research(mode === "urgent" ? "test-urgent" : "test-market"), extra: { eventDate: new Date().toISOString().slice(0, 10) } }) });
        if (/тексты/.test(job.label)) return send({ text: "```json\n" + JSON.stringify(content) + "\n```" });
        if (/проверка фактов/.test(job.label)) return send({ text: JSON.stringify({ content, changes: ["поправлена дата"] }) });
        if (/проверка картинки/.test(job.label) && /isometric/.test(job.system)) return send({ text: schemeAnswers.shift() ?? '{"markers": [], "letters": false, "glow": false, "busy": false, "note": ""}' });
        if (/проверка картинки/.test(job.label)) return send({ text: '{"aiLook": false, "text": false, "realPerson": false, "note": "похоже на снимок репортёра"}' });
        return send({ text: JSON.stringify({ content }) });
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.CAROUSEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-styles-"));
  process.env.CAROUSEL_CLAUDE_URL = base;
  process.env.CLAUDE_BRIDGE_TOKEN = "t".repeat(40);
  process.env.CODEX_IMAGE_BRIDGE_URL = base;
  process.env.CODEX_BRIDGE_TOKEN = "codex-test";
});

after(() => server?.close());

async function run(style: "urgent" | "market") {
  mode = style;
  const { createSidCarousel } = await import("../lib/carousel/sid/create");
  const { attachJob, getCarousel, slideFilePath, updateCarousel } = await import("../lib/carousel/store");
  const { runStyled } = await import("../lib/carousel/styles/pipeline");
  const created = createSidCarousel({ style });
  const c0 = updateCarousel(created.id, (x) => { attachJob(x, "generate"); });
  const steps: string[] = [];
  const note = await runStyled(created.id, c0.job!, (t) => steps.push(t));
  const c = getCarousel(created.id)!;
  for (const s of c.slides) assert.ok(fs.existsSync(slideFilePath(c.id, s.render!.file!)), `нет файла слайда ${s.id}`);
  const meta = await sharp(fs.readFileSync(slideFilePath(c.id, c.slides[0].render!.file!))).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1080, 1350, "jpeg"]);
  return { c, note: note ?? "", steps };
}

test("«Срочно»: конвейер собирает 3 фото-слайда одной серии, подпись и источники на месте", { timeout: 240_000 }, async () => {
  calls.length = 0;
  const { c, note, steps } = await run("urgent");
  assert.match(note, /Карусель готова/);
  assert.equal(c.slides.length, 3);
  assert.equal(c.sid!.styled!.stage, "done");
  assert.equal(c.sid!.stage, "done");
  assert.equal(c.title, "Из биткоин-ETF вывели $643 млн за день");
  assert.match(c.caption, /Пиши в комментариях/);
  assert.equal(c.sid!.sources!.length, 1);
  assert.equal(calls.filter((x) => x === "image").length, 3, "три фото");
  assert.equal(calls.filter((x) => /проверка картинки/.test(x)).length, 3, "каждую картинку смотрит Claude");
  assert.ok(steps.some((t) => /второе фото/.test(t)));
});

test("«Рынок»: обложка-сводка и по слайду на участника, у каждого своё фото", { timeout: 240_000 }, async () => {
  calls.length = 0;
  const { c } = await run("market");
  assert.equal(c.slides.length, 5);
  assert.equal(calls.filter((x) => x === "image").length, 5);
  assert.equal(c.slides[0].kind, "cover");
  assert.equal(c.slides[4].kind, "final");
});

test("тепловая карта «Кино»: биткоин и эфир первыми, дальше знакомые монеты; FIGR_HELOC, WBT и стейблкоины не попадают", async () => {
  const { pickHeat } = await import("../lib/carousel/styles/media");
  const coin = (id: string, symbol: string, cap: number, pct = -3) => ({ id, symbol, name: id, market_cap: cap, price_change_percentage_7d_in_currency: pct });
  const tiles = pickHeat([coin("tether", "usdt", 180e9), coin("figure-heloc", "figr_heloc", 15e9), coin("whitebit", "wbt", 9e9), coin("ripple", "xrp", 120e9), coin("ethereum", "eth", 280e9), coin("bitcoin", "btc", 1500e9), coin("solana", "sol", 60e9), coin("dogecoin", "doge", 20e9), coin("cardano", "ada", 15e9), coin("tron", "trx", 25e9), coin("wrapped-bitcoin", "wbtc", 10e9)], "7d");
  assert.deepEqual(tiles.slice(0, 2).map((t) => t.sym), ["btc", "eth"]);
  assert.ok(!tiles.some((t) => ["usdt", "figr_heloc", "wbt", "wbtc"].includes(t.sym)), tiles.map((t) => t.sym).join(","));
  assert.deepEqual(tiles.map((t) => t.sym), ["btc", "eth", "xrp", "sol", "trx", "doge", "ada"]);
});

test("разметка цвета не попадает на слайд даже непарная; в «Срочно» цвет только красный", async () => {
  assert.doesNotMatch(marks("[r]~$1 млрд[/r] и [r]$6,4 млрд"), /\[\/?r\]/);
  const { urgentHtml } = await import("../lib/carousel/styles/html");
  const hasFonts = fs.existsSync("fonts/Inter.ttf") && fs.existsSync("fonts/OswaldVar.ttf");
  if (hasFonts) {
    const html = urgentHtml(parseStyled("urgent", urgent()) as any, 1, "data:image/png;base64,", "@owner.threads");
    assert.ok(html.includes(".c-g,.c-b,.c-y,.c-w{color:#fff}"), "зелёный, синий и жёлтый в «Срочно» белые");
  }
  const { FIT } = await import("../lib/carousel/styles/html");
  assert.ok(FIT.includes("разметка видна на слайде"), "автопроверка ловит разметку перед сохранением");
});

test("обложка «Расследования» — обычное фото предмета истории; задание текстов знает недавние сцены и обложки", async () => {
  const { coverPrompt } = await import("../lib/carousel/sid/cover");
  const p = coverPrompt("Police carry computers out of an office.");
  assert.match(p, /ordinary real photograph/);
  assert.match(p, /object of the story is large and close/);
  assert.doesNotMatch(p, /hood|shallow depth|Reuters/);
  const { writeTask } = await import("../lib/carousel/sid/prompts");
  const w = writeTask({ topic: "x", topicKey: "x", angle: "", facts: [], pages: [] } as any, ["A cracked phone on a kitchen table"]);
  assert.match(w.user, /сам предмет истории крупным планом/);
  assert.match(w.user, /Обложки прошлых каруселей[\s\S]*A cracked phone on a kitchen table/);
  assert.match(p, /No glow, no neon/);
  assert.doesNotMatch(p, /techno-thriller|ARRI/);
  const { styledWriteTask } = await import("../lib/carousel/styles/prompts");
  const t = styledWriteTask("market", parseStyledResearch(research("x")), ["A trader at a window with skyscrapers and monitors, hand on his neck"]);
  assert.match(t.user, /Недавние сцены аккаунта/);
  assert.match(t.user, /hand on his neck/);
  assert.match(t.user, /метро/);
});

test("длинное пояснение к факту не обрезается посреди тега, оборванный тег на слайд не попадает", () => {
  const c = parseStyled("dispute", { topic: "Спор", topicKey: "spor", cover: { head: "Утечка?", sub: "Нет", scene: "x" }, posts: [{ head: "A", paras: ["a"], tweetId: "123456789" }, { head: "B", paras: ["b"], tweetId: "987654321" }], final: { head: "Что не сходится", intro: "и", facts: [["30 окт.", "[b]Binance[/b]: точкой входа мог быть [r]взломанный ноутбук DevOps-инженера[/r], по словам компании"]] }, caption: "a? b.", sources: [] }) as any;
  assert.match(c.final.facts[0][1], /DevOps-инженера\[\/r\], по словам компании$/);
  assert.doesNotMatch(marks("взломанный ноутбук["), /\[/);
  assert.doesNotMatch(marks("деньги [b]Bit"), /\[/);
});

test("подпись: два предложения с фактами и вопрос; третье предложение до вопроса ловится", () => {
  const two = "По данным Santiment, киты продали 160 000 ETH, а на биржах прибавилось 100 000 ETH. Эфир закончил октябрь с минусом 16,06%. Как думаешь, киты правда продают? Пиши в комментариях.";
  assert.deepEqual(captionSentences(two), ["По данным Santiment, киты продали 160 000 ETH, а на биржах прибавилось 100 000 ETH.", "Эфир закончил октябрь с минусом 16,06%.", "Как думаешь, киты правда продают?", "Пиши в комментариях."]);
  const ok = { ...urgent(), caption: two };
  assert.ok(!styledProblems("urgent", parseStyled("urgent", ok)).some((x) => x.startsWith("caption:")));
  const three = { ...urgent(), caption: "По данным 24/7 Wall St., рост HYPE не объяснить бегством с Binance. Биржа остановила вывод раньше. А по данным Decrypt, в Trade.xyz инвестирует ICE. Кто удержит рост? Пиши в комментариях." };
  assert.ok(styledProblems("urgent", parseStyled("urgent", three)).some((x) => x.startsWith("caption: до вопроса 3 предложения")));
});

test("«Срочно» принимает только событие сегодняшнего или вчерашнего дня", () => {
  const now = new Date("2026-11-08T09:35:00Z");
  assert.equal(urgentStaleness("2026-11-08", now, "Asia/Qyzylorda"), null);
  assert.equal(urgentStaleness("2026-11-07", now, "Asia/Qyzylorda"), null);
  assert.match(urgentStaleness("2026-11-06", now, "Asia/Qyzylorda")!, /событие от 2026-11-06/);
  assert.match(urgentStaleness("2026-11-12", now, "Asia/Qyzylorda")!, /ещё не наступила/);
  assert.match(urgentStaleness(undefined, now, "Asia/Qyzylorda")!, /нет даты события/);
  assert.match(urgentStaleness("вчера", now, "Asia/Qyzylorda")!, /нет даты события/);
  // день считается по часовому поясу аккаунта: 20:00 UTC 8-го — уже 9-е по Кызылорде
  assert.match(urgentStaleness("2026-11-07", new Date("2026-11-08T20:00:00Z"), "Asia/Qyzylorda")!, /событие от 2026-11-07/);
});

test("задание «Срочно» требует сегодня или вчера, остальные стили — неделю", async () => {
  const { styledResearchTask } = await import("../lib/carousel/styles/prompts");
  const urgent = styledResearchTask("urgent", "8 ноября 2026 г.", []);
  assert.match(urgent.user, /сегодня или вчера/);
  assert.match(urgent.user, /eventDate/);
  assert.match(urgent.user, /это про мои деньги/);
  assert.match(styledResearchTask("market", "8 ноября 2026 г.", []).user, /за последние 7 дней/);
  assert.match(styledResearchTask("urgent", "8 ноября 2026 г.", [], "событие от 2026-11-06").user, /Прошлая находка не подошла: событие от 2026-11-06/);
});

const SCHEME = () => ({
  head: "Как устроена сид-фраза", lead: "12 слов: это не пароль от приложения, а сам ключ от денег.", object: "Сейф с кодовым замком",
  parts: [["12 слов", "диски замка: важен каждый и их порядок"], ["Кошелёк", "дверца: открывается тому, кто набрал порядок"], ["Монеты", "лежат внутри, в сети, а не в телефоне"], ["Копия фразы", "второй набор дисков: открывает тот же сейф"]],
  scene: "A small steel safe with a combination lock of twelve dials. Marker 1: the dials. Marker 2: the door. Marker 3: the coins. Marker 4: a spare strip of dials.",
});
const dispute = (scheme?: unknown) => ({ topic: "Спор", topicKey: "spor", cover: { head: "Утечка?", sub: "Нет", scene: "x" }, posts: [{ head: "A", paras: ["a"], tweetId: "123456789" }, { head: "B", paras: ["b"], tweetId: "987654321" }], ...(scheme ? { scheme } : {}), final: { head: "Что не сходится", intro: "и", facts: [["30 окт.", "по словам компании"]] }, caption: "Кошелёк взломали. Сид-фраза утекла. Где хранишь свою? Пиши в комментариях.", sources: [] });

test("«Разбор»: слайд-схема с предметом и 3–4 частями проходит проверку; без частей карусель выходит без схемы", async () => {
  const c = parseStyled("dispute", dispute(SCHEME())) as any;
  assert.equal(c.scheme.parts.length, 4);
  assert.equal(c.scheme.object, "Сейф с кодовым замком");
  assert.deepEqual(styledProblems("dispute", c), []);
  assert.equal((parseStyled("dispute", dispute()) as any).scheme, undefined, "старые карусели без схемы читаются как раньше");
  assert.equal((parseStyled("dispute", dispute({ ...SCHEME(), parts: SCHEME().parts.slice(0, 2) })) as any).scheme, undefined, "две части — рисовать нечего");
  assert.equal((parseStyled("dispute", dispute({ ...SCHEME(), scene: "" })) as any).scheme, undefined);
  const long = SCHEME();
  long.parts[0] = ["Двенадцать слов сид-фразы кошелька", "диски — замка"];
  const p = styledProblems("dispute", parseStyled("dispute", dispute(long)));
  assert.ok(p.some((x) => x.startsWith("scheme.parts[0][0]:") && /пределе 22/.test(x)), p.join("; "));
  assert.ok(p.some((x) => x.startsWith("scheme.parts[0][1]: длинное тире")), p.join("; "));

  const { styledWriteTask, styledVerifyTask } = await import("../lib/carousel/styles/prompts");
  const r = parseStyledResearch(research("x"));
  const w = styledWriteTask("dispute", r).user;
  assert.match(w, /"scheme"/);
  assert.match(w, /Marker N/);
  assert.match(w, /чья работа и есть эта идея/);
  for (const other of ["urgent", "toolkit", "market", "cartoon", "cinema"] as const) assert.doesNotMatch(styledWriteTask(other, r).user, /scheme/, `стиль ${other} не тронут`);
  assert.match(styledVerifyTask(c, r).user, /Блок scheme объясняет общее устройство/);
  assert.doesNotMatch(styledVerifyTask(parseStyled("dispute", dispute()), r).user, /scheme/);
});

test("схема: слова ставит вёрстка, номера частей по порядку; художник получает квадрат, светлую изометрию и цифры", { timeout: 60_000 }, async () => {
  const { disputeSchemeHtml } = await import("../lib/carousel/styles/html");
  if (fs.existsSync("fonts/Inter.ttf") && fs.existsSync("fonts/OswaldVar.ttf")) {
    const html = disputeSchemeHtml(SCHEME() as any, "data:image/png;base64,", "@owner.threads");
    assert.ok(html.indexOf("<i>1</i>") > 0 && html.indexOf("<i>4</i>") > html.indexOf("<i>1</i>"));
    assert.match(html, /Сейф с кодовым замком/);
    assert.ok(html.includes('data-fit="scheme.parts[3][1]"'));
    assert.doesNotMatch(html, /Marker 1/, "английская сцена на слайд не попадает");
  }
  const { makeImage, SCHEME_RULES, schemeMarkers } = await import("../lib/carousel/styles/media");
  assert.match(SCHEME_RULES, /four tones/);
  assert.match(SCHEME_RULES, /white paper background/);
  assert.doesNotMatch(SCHEME_RULES, /neon|cinematic|glow/i, "хороший результат описан образцом");
  assert.match(schemeMarkers(3), /numbered 1, 2, 3/);
  imageJobs.length = 0; calls.length = 0;
  // первая попытка: цифра 3 дважды и нет 4 — на перерисовку; вторая годится
  schemeAnswers = ['{"markers": [1, 2, 3, 3], "letters": false, "glow": false, "busy": false, "note": "тройка дважды"}', '{"markers": [2, 1, 4, 3], "letters": false, "glow": false, "busy": false, "note": "ок"}'];
  const steps: string[] = [];
  const out = await makeImage(SCHEME().scene, "scheme", { label: "схему", markers: 4, onStep: (t) => steps.push(t) });
  assert.equal(out.note, undefined);
  assert.equal(imageJobs.length, 2);
  assert.equal(imageJobs[0].aspectRatio, "1:1");
  assert.match(imageJobs[0].prompt, /Isometric technical illustration/);
  assert.match(imageJobs[0].prompt, /exactly 4 small round markers numbered 1, 2, 3, 4/);
  assert.match(imageJobs[1].prompt, /rejected because: цифры в кружках 1,2,3,3, а нужны 1,2,3,4/);
  assert.deepEqual(steps, ["Рисую схему", "Перерисовываю схему (попытка 2)"]);
});

test("схема уже нарисована: правки текста не меняют число частей и сцену", async () => {
  const { keepScheme } = await import("../lib/carousel/styles/pipeline");
  const before = parseStyled("dispute", dispute(SCHEME()));
  const shorter = parseStyled("dispute", dispute({ ...SCHEME(), parts: SCHEME().parts.slice(0, 3), scene: "Another object." })) as any;
  assert.equal(keepScheme(before, shorter).scheme.parts.length, 4, "три части вместо четырёх — остаётся прежняя схема");
  const reworded = SCHEME();
  reworded.parts[2] = ["Деньги", "лежат в сети, а не в телефоне"];
  const after = keepScheme(before, parseStyled("dispute", dispute({ ...reworded, scene: "Another object." }))) as any;
  assert.equal(after.scheme.parts[2][0], "Деньги");
  assert.match(after.scheme.scene, /combination lock/);
  assert.match((keepScheme(before, parseStyled("dispute", dispute())) as any).scheme.scene, /combination lock/, "проверка не может выбросить нарисованную схему");
  assert.equal((keepScheme(parseStyled("dispute", dispute()), parseStyled("dispute", dispute())) as any).scheme, undefined);
});

test("«Срочно» пишет простыми словами, а проверка фактов их не возвращает к языку источника", async () => {
  const { styledWriteTask, styledVerifyTask } = await import("../lib/carousel/styles/prompts");
  const r = parseStyledResearch(research("x"));
  const write = styledWriteTask("urgent", r, []);
  assert.match(write.user, /как сказал бы другу/);
  assert.match(write.user, /Если Tether заморозит твои USDT/);
  assert.match(write.user, /На слайде одна мысль/);
  assert.match(write.user, /Добивка \(sub\) — тоже факт простыми словами/);
  assert.match(styledVerifyTask(parseStyled("urgent", { topic: "x", slides: [{ text: "a" }, { text: "b" }, { text: "c" }] }), r).user, /Правишь смысл, а не язык/);
  assert.match(styledVerifyTask(parseStyled("urgent", { topic: "x", slides: [{ text: "a" }, { text: "b" }, { text: "c" }] }), r).user, /«депозитарий» → «тот, кто хранит твою крипту»/);
});
