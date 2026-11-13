import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { BrowserContext, Page } from "playwright";
import { accountLabel, HOME_URL, identity, LOGIN_URL, needsLogin, openIgBrowser } from "../lib/trends/instagram";
import { isHandle, netscapeCookies } from "../lib/trends/parse";
import { analyzeOne, runTrends, writeIdea } from "../lib/trends/pipeline";
import { BROWSER_DIR, cardDir, isCardKey, PROFILE_DIR, readTrendsState, TRENDS_DIR, writeTrendsState } from "../lib/trends/state";
import { MAX_ACCOUNTS_PER_RUN, ROLES, THEMES, type TrendAccount, type TrendRun } from "../lib/trends/types";

/**
 * Контейнер gudini-ig-browser: свой Chromium с входом владельца в Instagram и прогоны «Трендов».
 * Устроен как gudini-tiktok-browser: HTTP только из сети Docker с токеном, вход через поток кадров,
 * пароль уходит только в Instagram. Прогон запускает только кнопка на сайте — своего таймера нет.
 */

const state = readTrendsState();
const persist = () => writeTrendsState(state);
let context: BrowserContext | undefined;
let page: Page | undefined;
let login = false;
let loginUntil = 0;
let lastError = "";
let commandBusy = false;
/** идёт прогон или переписывание идеи */
let busy: string | null = null;
let stopRequested = false;
const token = process.env.IG_BROWSER_TOKEN || "";
const host = process.env.IG_BROWSER_HOST || "127.0.0.1";
if (host !== "127.0.0.1" && !token) throw new Error("IG_BROWSER_TOKEN обязателен для сетевого обработчика.");
const COOKIES_FILE = path.join(BROWSER_DIR, "cookies.txt");

/** Кэши, которые Chromium собирает заново (урок браузера X): вход в cookies и local storage не трогаем. */
function trimProfileCaches() {
  for (const name of ["Cache", "Code Cache", "GPUCache", "Service Worker", "DawnGraphiteCache", "DawnWebGPUCache"])
    fs.rmSync(path.join(PROFILE_DIR, "Default", name), { recursive: true, force: true });
}

async function browserPage(): Promise<Page> {
  if (!context) {
    fs.mkdirSync(BROWSER_DIR, { recursive: true, mode: 0o700 });
    context = await openIgBrowser();
    context.on("close", () => { context = undefined; page = undefined; });
  }
  if (!page || page.isClosed()) {
    page = context.pages()[0] ?? await context.newPage();
    for (const extra of context.pages()) if (extra !== page) await extra.close();
  }
  page.setDefaultTimeout(15_000);
  return page;
}

async function closeBrowser() {
  await context?.close().catch(() => {});
  context = undefined;
  page = undefined;
  fs.rmSync(COOKIES_FILE, { force: true });
}

const current = () => state.runs.at(-1);

function status() {
  const run = current();
  return {
    connected: state.browser.connected,
    account: state.browser.connected ? state.browser.accountLabel || "Instagram" : null,
    login, busy: Boolean(busy), working: busy, error: lastError,
    run: run ? { id: run.id, theme: run.theme, state: run.state, step: run.step, progress: run.progress, startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error } : null,
  };
}

function cleanAccounts(raw: unknown): TrendAccount[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error("Нет аккаунтов для прогона");
  if (raw.length > MAX_ACCOUNTS_PER_RUN) throw new Error(`За прогон читаем не больше ${MAX_ACCOUNTS_PER_RUN} аккаунтов`);
  return raw.map((a: any) => {
    const instagram = isHandle(a?.instagram) ? a.instagram : undefined;
    const youtube = isHandle(a?.youtube) ? a.youtube : undefined;
    if (typeof a?.id !== "string" || !/^[a-z0-9-]{4,40}$/.test(a.id) || (!instagram && !youtube)) throw new Error("Некорректный аккаунт");
    return { id: a.id, theme: a.theme, role: ROLES.includes(a.role) ? a.role : "direct", instagram, youtube, status: "active", addedAt: String(a.addedAt ?? "") };
  });
}

function startRun(body: any) {
  if (!THEMES.includes(body?.theme)) throw new Error("Неизвестная тема");
  const accounts = cleanAccounts(body.accounts);
  const run: TrendRun = { id: crypto.randomUUID(), theme: body.theme, state: "running", step: "Начинаем", progress: 0, startedAt: new Date().toISOString(), reads: [], cards: [] };
  state.runs.push(run);
  persist();
  busy = "run";
  stopRequested = false;
  void runTrends(run, accounts, pipelineDeps()).finally(async () => {
    await closeBrowser();
    busy = null;
  });
  return status();
}

function pipelineDeps() {
  return {
    state, persist,
    page: async () => (state.browser.connected ? browserPage() : null),
    lostLogin: () => { state.browser.connected = false; persist(); },
    cookies: async () => {
      if (!context) return undefined;
      fs.writeFileSync(COOKIES_FILE, netscapeCookies(await context.cookies(HOME_URL)), { mode: 0o600 });
      return COOKIES_FILE;
    },
    stopped: () => stopRequested,
  };
}

/**
 * «Разобрать»: найденный, но не вошедший в разбор прогона выброс — как в прогоне. keys — несколько карточек
 * подряд; force — разобрать заново уже разобранные (кадры и речь берутся прежние, без нового скачивания).
 */
function startAnalyze(body: any) {
  const keys: unknown[] = Array.isArray(body?.keys) ? body.keys.slice(0, 100) : [body?.key];
  const force = body?.force === true;
  const cards = keys.map((key) => (isCardKey(key) ? state.cards.find((c) => c.key === key) : undefined));
  if (!cards.length || cards.some((c) => !c)) throw new Error("Карточка не найдена");
  const list = cards as NonNullable<(typeof cards)[number]>[];
  if (list.some((c) => !["found", "error", ...(force ? ["ready"] : [])].includes(c.state))) throw new Error("Эта карточка уже разобрана или разбирается");
  if (list.some((c) => c.source === "instagram" && !(c.frames.length && c.spokenHook !== undefined)) && !state.browser.connected)
    throw new Error("Для рилса нужен вход в браузер Instagram.");
  busy = "analyze";
  stopRequested = false;
  for (const card of list) {
    card.state = "queued";
    card.step = "В очереди на разбор";
    if (force) Object.assign(card, { analysis: undefined, idea: undefined, ideaError: undefined });
  }
  persist();
  void (async () => {
    for (const card of list) {
      if (stopRequested) {
        Object.assign(card, { state: "found", step: undefined });
        continue;
      }
      await analyzeOne(card, pipelineDeps());
    }
    persist();
  })().finally(async () => {
    await closeBrowser();
    busy = null;
  });
  return status();
}

function startRewrite(body: any) {
  const card = state.cards.find((c) => c.key === body?.key);
  if (!card || !isCardKey(body.key)) throw new Error("Карточка не найдена");
  if (!card.analysis) throw new Error("У карточки ещё нет разбора");
  busy = "rewrite";
  card.step = card.idea?.kind === "sketch" ? "Claude пишет другой сюжет" : "Claude пишет другой сценарий";
  persist();
  const previous = card.idea;
  void writeIdea(card, previous)
    .then((idea) => { card.idea = idea; card.ideaError = undefined; })
    .catch((e) => { card.ideaError = e instanceof Error ? e.message : "Claude не ответил"; })
    .finally(() => { card.step = undefined; persist(); busy = null; });
  return status();
}

async function command(action: string, body: any) {
  if (action === "status") return status();
  if (action === "stop") {
    if (busy !== "run" && busy !== "analyze") throw new Error("Прогон не идёт");
    stopRequested = true;
    return status();
  }
  if (action === "hide") {
    if (busy) throw new Error("Дождитесь окончания прогона");
    const index = state.cards.findIndex((c) => c.key === body?.key);
    if (index < 0 || !isCardKey(body.key)) throw new Error("Карточка не найдена");
    state.cards.splice(index, 1);
    fs.rmSync(cardDir(body.key), { recursive: true, force: true });
    persist();
    return status();
  }
  if (busy) throw new Error(busy === "run" ? "Идёт прогон. Дождитесь его окончания или остановите." : "Claude ещё пишет вариант.");
  if (action === "run") {
    if (login) throw new Error("Сначала закончите вход в Instagram или закройте окно входа.");
    return startRun(body);
  }
  if (action === "rewrite") return startRewrite(body);
  if (action === "analyze") return startAnalyze(body);
  if (action === "login") {
    login = true; loginUntil = Date.now() + 15 * 60_000;
    try {
      const p = await browserPage();
      await p.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (e) { login = false; await closeBrowser(); throw e; }
    return status();
  }
  if (action === "disconnect") {
    login = false;
    await closeBrowser();
    // ровно наш каталог профиля, а не путь из запроса
    const profile = path.resolve(PROFILE_DIR);
    if (path.dirname(profile) !== path.resolve(BROWSER_DIR)) throw new Error("Некорректный путь профиля");
    fs.rmSync(profile, { recursive: true, force: true });
    state.browser = { connected: false };
    persist();
    return status();
  }
  /**
   * Владелец вошёл в настоящем окне браузера на своём компьютере (scripts/ig-login.mjs), как с X;
   * сюда приходят только cookies той сессии, пароль нигде не участвует.
   */
  if (action === "import") {
    const cookies = (Array.isArray(body?.cookies) ? body.cookies : []).filter((c: any) =>
      typeof c?.name === "string" && typeof c?.value === "string" && typeof c?.domain === "string" && /(^|\.)instagram\.com$/.test(c.domain));
    if (!cookies.some((c: any) => c.name === "sessionid")) throw new Error("В файле сессии нет ключа входа Instagram (sessionid).");
    login = false;
    await closeBrowser();
    const p = await browserPage();
    await context!.clearCookies();
    await context!.addCookies(cookies);
    const account = await identity(context!);
    if (!account) throw new Error("Сессия перенесена не полностью: нет ds_user_id.");
    await p.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await p.waitForTimeout(3000);
    if (needsLogin(p)) throw new Error("Instagram не принял перенесённую сессию и просит вход.");
    const handle = typeof body.handle === "string" && /^[A-Za-z0-9._]{1,40}$/.test(body.handle) ? body.handle : await accountLabel(p);
    state.browser = { connected: true, account, accountLabel: handle };
    persist();
    await closeBrowser();
    return status();
  }
  if (!login) throw new Error("Сначала откройте окно входа в Instagram.");
  const p = await browserPage();
  if (action === "frame") return { image: (await p.screenshot({ type: "jpeg", quality: 75 })).toString("base64") };
  if (action === "input") {
    loginUntil = Date.now() + 15 * 60_000;
    if (body.type === "click" && Number.isFinite(body.x) && Number.isFinite(body.y) && body.x >= 0 && body.x <= 1280 && body.y >= 0 && body.y <= 900) await p.mouse.click(body.x, body.y);
    else if (body.type === "text" && typeof body.text === "string" && body.text.length <= 1000) await p.keyboard.insertText(body.text);
    else if (body.type === "key" && ["Tab", "Enter", "Backspace", "Escape", "ControlOrMeta+A", "ArrowDown", "ArrowUp"].includes(body.key)) await p.keyboard.press(body.key);
    else if (body.type === "scroll" && Number.isFinite(body.dy)) await p.mouse.wheel(0, Math.max(-800, Math.min(800, body.dy)));
    else throw new Error("Неизвестное действие окна входа");
    return { ok: true };
  }
  if (action === "finish") {
    const account = await identity(context!);
    if (!account) throw new Error("Вход ещё не завершён. Войдите в Instagram и повторите проверку.");
    await p.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const label = await accountLabel(p);
    state.browser = { connected: true, account, accountLabel: label ?? (state.browser.account === account ? state.browser.accountLabel : undefined) };
    persist();
    login = false;
    await closeBrowser();
    return status();
  }
  if (action === "close") { login = false; await closeBrowser(); return status(); }
  throw new Error("Неизвестная команда");
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
  const respond = (code: number, data: unknown) => { res.statusCode = code; res.end(JSON.stringify(data)); };
  if (token && req.headers.authorization !== `Bearer ${token}`) return respond(401, { error: "Unauthorized" });
  const action = (req.url || "").slice(1);
  if (!/^[a-z]+$/.test(action)) return respond(404, { error: "Not found" });
  if (req.method !== "POST" && !(req.method === "GET" && ["status", "frame"].includes(action))) return respond(405, { error: "Method not allowed" });
  // состояние только читается: страница опрашивает его и во время долгого перехода окна входа
  if (action === "status") return respond(200, status());
  if (commandBusy) return respond(409, { error: "Действие Instagram ещё выполняется." });
  commandBusy = true;
  try {
    let data = "";
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 65_536) throw new Error("Запрос слишком большой");
    }
    respond(200, await command(action, data ? JSON.parse(data) : {}));
    lastError = "";
  } catch (e) {
    // в ошибках Playwright может оказаться набранный текст: тело запроса и ввод не логируем
    lastError = action === "input" ? "Не удалось выполнить ввод. Обновите окно входа." : e instanceof Error ? e.message : "Ошибка Instagram";
    respond(400, { error: lastError });
  } finally { commandBusy = false; }
});

// прогон, оборванный перезапуском контейнера, не продолжается сам: его снова запускает кнопка
for (const run of state.runs) if (run.state === "running") Object.assign(run, { state: "error", step: "Прогон прервался.", error: "Контейнер перезапустился во время прогона.", finishedAt: new Date().toISOString() });
for (const card of state.cards) if (card.state === "working" || card.state === "queued") Object.assign(card, { state: "error", error: "Разбор прервался перезапуском.", step: undefined });
for (const card of state.cards) if (card.step) card.step = undefined;
fs.mkdirSync(TRENDS_DIR, { recursive: true });
trimProfileCaches();
persist();

server.listen(Number(process.env.IG_BROWSER_PORT || 43137), host, () => {
  const address = server.address();
  console.log(`Браузер Instagram для трендов запущен: ${typeof address === "object" && address ? address.port : ""}`);
  setInterval(async () => {
    if (login && Date.now() > loginUntil && !commandBusy) { login = false; await closeBrowser(); }
  }, 10_000);
});
server.on("error", (e) => { console.error(e.message); process.exit(1); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => {
  stopRequested = true;
  server.close(); await context?.close().catch(() => {}); process.exit(0);
});
