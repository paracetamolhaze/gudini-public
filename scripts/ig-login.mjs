// Вход в Instagram для «Трендов» в настоящем окне браузера на этом компьютере — как вход в X.
//
// Окно открывается на вашем экране, вы входите как обычно — своей клавиатурой. Пароль идёт напрямую
// в Instagram: скрипт его не видит и не сохраняет. Когда вход выполнен, скрипт сам это замечает,
// сохраняет только cookies сессии в указанный файл и закрывает окно. Дальше файл переносится
// в контейнер gudini-ig-browser (команда import) и удаляется.
//
// Запуск:  node scripts/ig-login.mjs [путь-к-файлу-сессии]
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const out = process.argv[2] || path.join(os.tmpdir(), "ig-session.json");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ig-login-"));
const DEADLINE_MS = 15 * 60_000;

// Настоящий Chrome без признака автоматизации: так окно выглядит обычным браузером.
// Если Chrome не установлен — берём свой Chromium.
const opts = {
  headless: false,
  viewport: null,
  args: ["--window-size=1280,900", "--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
  locale: "en-US",
};
const ctx = await chromium
  .launchPersistentContext(profile, { ...opts, channel: "chrome" })
  .catch(() => chromium.launchPersistentContext(profile, opts));
const page = ctx.pages()[0] ?? (await ctx.newPage());

async function loggedIn() {
  try {
    const cookies = await ctx.cookies("https://www.instagram.com");
    // sessionid и ds_user_id появляются только у вошедшего пользователя
    return cookies.some((c) => c.name === "sessionid" && c.value.length > 10) && cookies.some((c) => c.name === "ds_user_id");
  } catch {
    return false;
  }
}

await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
console.log("Окно открыто. Войдите в Instagram — я жду и не трогаю страницу.");

const until = Date.now() + DEADLINE_MS;
let ok = false;
while (Date.now() < until) {
  if (await loggedIn()) {
    // Instagram дописывает остальные cookies после перехода в ленту
    await page.waitForTimeout(5000);
    ok = true;
    break;
  }
  if (page.isClosed() && !ctx.pages().length) break;
  await new Promise((r) => setTimeout(r, 2000));
}

if (!ok) {
  console.error("Вход не завершён: sessionid так и не появился.");
  await ctx.close().catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(1);
}

let handle = "";
try {
  if (!/instagram\.com\/?$/.test(page.url())) await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
  const alt = await page.locator('img[alt$="profile picture"]').first().getAttribute("alt", { timeout: 15_000 });
  handle = alt?.match(/^(.+?)'s profile picture$/)?.[1] ?? "";
} catch {
  handle = "";
}

const cookies = await ctx.cookies("https://www.instagram.com");
fs.writeFileSync(out, JSON.stringify({ cookies, handle }), { mode: 0o600 });
console.log(`Вход выполнен${handle ? `: @${handle}` : ""}. Сессия сохранена: ${out}`);
await ctx.close().catch(() => {});
fs.rmSync(profile, { recursive: true, force: true });
