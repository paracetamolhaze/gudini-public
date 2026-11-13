import { SCENARIO_REVIEW_RULES } from "../lib/carousel/scenarioIntent";
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCarousel, newId } from "../lib/carousel/store";
import { parseCreateRequest } from "../lib/carousel/request";
import { writePlan, writeEdit, writeSlide } from "../lib/carousel/writer";
import { readSpend } from "../lib/carousel/spend";
import { setOpenRouterFetch } from "../lib/carousel/openrouter";

test("carousel writing uses Codex without API key or image budget; failures never fall back", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "carousel-codex-"));
  const saved = { ...process.env };
  process.env.CAROUSEL_DATA_DIR = root;
  process.env.CAROUSEL_TEXT_MODEL = "gpt-6-astra";
  process.env.CAROUSEL_MONTHLY_BUDGET_USD = "0";
  process.env.CAROUSEL_MAX_COST_PER_CAROUSEL_USD = "0";
  delete process.env.CAROUSEL_OPENROUTER_API_KEY;
  process.env.CODEX_BRIDGE_TOKEN = "test-token";
  let apiCalls = 0;
  setOpenRouterFetch(async () => { apiCalls++; throw new Error("Unexpected paid API"); });
  const draft = { title: "Порядок на столе", story: ["крючок", "совет", "итог"], caption: "Оставьте место для работы.", hashtags: ["#порядок"], claimsToCheck: [], slides: [
    { kind: "cover", title: "Освободите рабочий стол", body: "Три минуты на порядок" },
    { kind: "content", title: "Уберите лишние предметы", body: "Положите бумаги в папку, а провода закрепите у края." },
    { kind: "final", title: "Закрепите привычку", body: "В конце дня возвращайте вещи на места.", cta: "Сохраните этот совет" }
  ] };
  let output: unknown = draft;
  const evidence = { sources: [{ id: "s1", url: "https://example.org/study", title: "Study", publishedAt: null }, { id: "s2", url: "https://example.org/report", title: "Report", publishedAt: null }], facts: [1, 2, 3].map(n => ({ claim: `Evidence ${n}`, period: "2026-01", sourceIds: ["s1", "s2"] })), analysis: ["Conclusion"], limitations: [] };
  let fail = false;
  const requests: any[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.setHeader("Content-Type", "application/json");
    res.statusCode = fail ? 502 : 200;
    res.end(JSON.stringify(fail ? { error: "Лимит подписки" } : { text: JSON.stringify(requests.at(-1).webSearch ? evidence : requests.at(-1).system === SCENARIO_REVIEW_RULES ? { ok: true, issues: [] } : output), usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0 }, runId: "test-run", durationMs: 10 }));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  process.env.CODEX_BRIDGE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    // прежние текстовые карточки (schema 2) остаются на Codex, когда мост Claude не выбран
    delete process.env.SCRIPT_LLM_TRANSPORT;
    const c = createCarousel({ idea: "Порядок на рабочем столе", wishes: "", slideCount: 3, language: "ru", style: "graphite", format: "portrait" });
    const plan = await writePlan(c, "test-plan");
    assert.equal(plan.draft.slides.length, 3);
    assert.equal(plan.research?.sources.length, 2);
    assert.equal(requests[0].webSearch, "live");
    assert.ok(requests.filter(r => !r.webSearch && r.system !== SCENARIO_REVIEW_RULES).every(r => r.user.includes("Evidence 1")));
    c.slides = plan.draft.slides.map(s => ({ ...s, id: newId("s") })) as typeof c.slides;
    await writeEdit(c, "Сохрани содержание", "test-edit");
    output = { slide: draft.slides[1] };
    await writeSlide(c, 1, "Сделай короче", "test-slide");
    assert.ok(requests.every(r => r.stage === "Carousel Text" && r.model === "gpt-6-astra"));
    assert.ok(readSpend().every(e => e.billing === "subscription" && e.cost === 0 && e.status === "done"));
    const count = requests.length;
    fail = true;
    await assert.rejects(writePlan(c, "test-fail"), /Лимит подписки/);
    assert.equal(requests.length, count + 1);
    assert.equal(apiCalls, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    setOpenRouterFetch(null);
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("карусель по скиллу пишет Claude через мост сценариев: справка с веб-поиском, роли по местам, финал — строка про закрытый канал", async () => {
  const { DECK_SCENARIO_REVIEW_RULES } = await import("../lib/carousel/scenarioIntent");
  const { deckDesign } = await import("../lib/carousel/deck");
  const { DEFAULT_DESIGN } = await import("../lib/carousel/designShared");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "carousel-claude-"));
  const saved = { ...process.env };
  process.env.CAROUSEL_DATA_DIR = root;
  process.env.SCRIPT_LLM_TRANSPORT = "claude";
  process.env.CLAUDE_BRIDGE_TOKEN = "test-token";
  process.env.CLAUDE_SCRIPT_MODEL = "claude-opus-5-5";
  process.env.CODEX_BRIDGE_URL = "http://127.0.0.1:9";
  process.env.CODEX_BRIDGE_TOKEN = "test-token";
  const s = (kind: string, title: string, body = "", bullets: string[] = []) => ({ kind, title, body, bullets, cta: "Подпишись" });
  const draft = {
    title: "Проверка токена",
    story: ["зацепка", "ставка", "держатели", "контракт", "ликвидность", "обсуждение", "итог", "Telegram"],
    slides: [
      s("cover", "Проверь токен **за 5 минут**", "Четыре проверки, которых не видно на графике"),
      s("content", "Пять минут проверки дешевле, чем токен, который нельзя продать"),
      s("content", "Кто держит монеты", "Открой список держателей. Если у пяти кошельков больше половины монет, цену решают они."),
      s("content", "Можно ли его продать", "Сервисы проверки контракта показывают запрет на продажу и скрытую комиссию."),
      s("content", "Заперта ли ликвидность", "Если создатель может забрать пул, монеты станут фантиками за одну транзакцию."),
      s("content", "Кто говорит о проекте", "Сотни одинаковых сообщений — это боты, а не спрос."),
      s("content", "Чек-лист перед покупкой", "", ["Нет кошелька с половиной монет", "Контракт разрешает продажу", "Ликвидность заперта", "Обсуждают живые люди"]),
      s("final", "Новые токены разбираю в Telegram", "Лишняя строка"),
    ],
    caption: "Пять минут проверки дешевле, чем токен, который нельзя продать.\n\nСмотрим держателей, контракт, ликвидность и обсуждение.\n\nВсё это видно до покупки.\n\nРазборы новых токенов - в моём Telegram-канале, QR на последнем слайде.",
    hashtags: ["#мемкоины", "#криптовалюта", "#токены"],
    claimsToCheck: [],
  };
  const evidence = { sources: [{ id: "s1", url: "https://example.org/a", title: "A", publishedAt: null }, { id: "s2", url: "https://example.org/b", title: "B", publishedAt: null }], facts: [1, 2, 3].map(n => ({ claim: `Evidence ${n}`, period: "2026-01", sourceIds: ["s1", "s2"] })), analysis: ["Conclusion"], limitations: [] };
  let output: unknown = draft;
  const requests: any[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    res.setHeader("Content-Type", "application/json");
    const text = body.tools === "web" ? evidence : body.system === DECK_SCENARIO_REVIEW_RULES ? { ok: true, issues: [] } : output;
    res.end(JSON.stringify({ text: JSON.stringify(text), usage: { inputTokens: 10, outputTokens: 20 }, model: body.model }));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  process.env.CLAUDE_BRIDGE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const parsed = parseCreateRequest({ idea: "Как проверить токен перед покупкой" });
    assert.ok("request" in parsed);
    if (!("request" in parsed)) return;
    assert.equal(parsed.mode, "text_cards");
    assert.equal(parsed.deck, true);
    assert.equal(parsed.request.slideCount, 8);
    // рисованный режим аккаунта в копию оформления не попадает
    const c = createCarousel(parsed.request, { mode: parsed.mode, deck: true, design: deckDesign({ ...DEFAULT_DESIGN, author: "TG:@owner_crypto", artworkMode: "painted", characterDescription: "Hero" }) });
    assert.equal(c.schema, 3);
    assert.equal(c.design?.artworkMode, undefined);
    const plan = await writePlan(c, "deck-plan");
    assert.deepEqual(plan.draft.slides.map(x => x.kind), ["cover", "stake", "content", "content", "content", "content", "recap", "final"]);
    assert.deepEqual(plan.notes, []);
    // финал — одна строка про канал: QR ставит сайт, кнопки и лишнего текста нет
    assert.deepEqual([plan.draft.slides[7].body, plan.draft.slides[7].cta, plan.draft.slides[1].cta], ["", "", ""]);
    assert.match(plan.draft.caption, /QR на последнем слайде\./);
    assert.equal(requests.length, 3, "справка, план и проверка замысла — без исправлений");
    assert.equal(requests[0].tools, "web");
    assert.ok(requests.every(r => r.task === "carousel" && r.model === "claude-opus-5-5"));
    assert.match(requests[1].system, /stake — ставка/);
    assert.doesNotMatch(requests[1].system, /Hero|мастихином/);
    assert.match(requests[1].messages[0].content, /обложка, ставка, 4 карточки-мысли, итог и финал/);
    assert.match(requests[1].messages[0].content, /Telegram-канал автора: «Алексей Гудов \| FX GOLD»/);
    assert.doesNotMatch(requests[1].system + requests[1].messages[0].content, /owner_crypto/);
    c.slides = plan.draft.slides.map(x => ({ ...x, id: newId("s") })) as typeof c.slides;
    output = { slide: { kind: "final", title: "Ещё разборы — в Telegram", body: "Новые токены каждый день", cta: "Жми сюда" } };
    const slide = await writeSlide(c, 7, "Короче", "deck-slide");
    assert.deepEqual([slide.slide.title, slide.slide.body, slide.slide.cta], ["Ещё разборы — в Telegram", "", ""]);
    assert.ok(readSpend().every(e => e.billing === "subscription" && e.cost === 0 && e.status === "done" && /Claude/.test(e.note ?? "")));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
