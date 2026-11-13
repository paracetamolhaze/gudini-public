import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import sharp from "sharp";

/** A captured page: the picture, where the marked phrase is on it (image pixels), and whether the page is dark. */
export type ScreenShot = {
  file: string; size: { w: number; h: number; focus?: [number, number, number, number]; dark: boolean }; title: string;
  /** The phrase to mark was not found on the page: the page is shown unmarked. */
  missed?: boolean;
};

const VIEW = { width: 1280, height: 1500, scale: 1.5 };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

/** Addresses inside the machine or the local network: the screenshot browser never goes there. */
export function privateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
    return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
  }
  return true;
}

const hostVerdicts = new Map<string, Promise<boolean>>();
/** A host is public when every address it resolves to is public; names of the local network are never. */
export function publicHost(host: string): Promise<boolean> {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  let verdict = hostVerdicts.get(name);
  if (!verdict) {
    verdict = (async () => {
      if (!name || name === "localhost" || /\.(local|internal|localhost|lan|home|corp)$/.test(name) || !name.includes(".") && !net.isIP(name)) return false;
      if (net.isIP(name)) return !privateAddress(name);
      try {
        const found = await dns.lookup(name, { all: true });
        return found.length > 0 && found.every(a => !privateAddress(a.address));
      } catch { return false; }
    })();
    hostVerdicts.set(name, verdict);
  }
  return verdict;
}

/** Only plain web pages on public hosts, without credentials or unusual ports. */
export async function allowedUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (url.port && !["80", "443"].includes(url.port)) return null;
  return (await publicHost(url.hostname)) ? url : null;
}

function browserPath(): string {
  const candidates = [process.env.ASTRA_BROWSER_PATH, process.env.HYPERFRAMES_BROWSER_PATH,
    path.resolve(import.meta.dirname, "../node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell")];
  const found = candidates.find((p): p is string => Boolean(p && fs.existsSync(p)));
  if (!found) throw new Error("нет браузера для снимков страниц (ASTRA_BROWSER_PATH)");
  return found;
}

/** Signs that the page is a gate instead of the page: a bot check, a block, an error. */
const GATE = /just a moment|attention required|access denied|verify you are human|checking your browser|are you a robot|captcha|подтвердите, что вы не робот|enable javascript and cookies|403 forbidden|404 not found|page not found|страница не найдена|ошибка 404/i;

/**
 * Runs inside the page, passed as text (the bundler's helpers do not exist there): the box of a phrase on the page.
 * The browser's own search finds it across links and line breaks, as Ctrl+F does; otherwise the smallest visible
 * element that holds it, letters and digits compared without punctuation.
 */
const FIND_PHRASE = `function (needle) {
  function letter(c) { c = c.toLowerCase(); if (c === "ё") c = "е"; return /[0-9a-zа-я]/.test(c) ? c : ""; }
  function norm(t) { var out = "", k, c; for (k = 0; k < t.length; k++) { c = letter(t[k]); if (c) out += c; else if (out && out[out.length - 1] !== " ") out += " "; } return out.trim(); }
  var want = norm(needle), all = document.querySelectorAll("body *"), best = null, bestArea = Infinity, j;
  if (!want) return null;
  for (j = 0; j < all.length; j++) {
    var el = all[j], text = el.textContent || "";
    if (text.length < want.length || norm(text).indexOf(want) < 0) continue;
    var b = el.getBoundingClientRect();
    if (b.width * b.height < 16 || b.width * b.height >= bestArea) continue;
    var st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) continue;
    best = el; bestArea = b.width * b.height;
  }
  if (!best) return null;
  var walker = document.createTreeWalker(best, NodeFilter.SHOW_TEXT), joined = "", map = [], node, k, c;
  for (node = walker.nextNode(); node; node = walker.nextNode()) {
    var t = node.textContent || "";
    for (k = 0; k < t.length; k++) {
      c = letter(t[k]);
      if (c) { joined += c; map.push([node, k]); }
      else if (joined && joined[joined.length - 1] !== " ") { joined += " "; map.push([node, k]); }
    }
  }
  var at = joined.indexOf(want), r = best.getBoundingClientRect();
  if (at >= 0) {
    var range = document.createRange(), a = map[at], z = map[at + want.length - 1];
    range.setStart(a[0], a[1]); range.setEnd(z[0], z[1] + 1);
    var tight = range.getBoundingClientRect();
    if (tight.width > 2 && tight.height > 2 && tight.height < 240) r = tight;
  }
  return { x: r.left, y: r.top + scrollY, w: Math.min(r.width, innerWidth - r.left), h: Math.min(r.height, 300) };
}`;

/**
 * Opens the page in a desktop browser, hides cookie banners and pop-ups, finds `find` on it and scrolls it to the upper
 * third of the screen, then takes the screen as a person would see it (a fixed header stays where it is).
 * The phrase's box comes back in image pixels, so the montage can mark it.
 */
export async function captureScreen(rawUrl: string, find: string | undefined, dir: string): Promise<ScreenShot | { error: string }> {
  const url = await allowedUrl(rawUrl);
  if (!url) return { error: "адрес не открыть: нужен обычный https-адрес публичного сайта" };
  const tag = createHash("sha1").update(`${url.href}#${find ?? ""}`).digest("hex").slice(0, 10);
  const file = path.join(dir, `${url.hostname.replace(/[^a-z0-9.-]/gi, "")}-${tag}.jpg`);
  const meta = `${file}.json`;
  if (fs.existsSync(file) && fs.existsSync(meta)) return { file, ...JSON.parse(fs.readFileSync(meta, "utf8")) };
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath: browserPath(), headless: true, acceptInsecureCerts: false,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--mute-audio", "--lang=ru-RU",
        "--webrtc-ip-handling-policy=disable_non_proxied_udp", "--force-webrtc-ip-handling-policy", "--disable-features=Translate"],
    });
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8" });
    await page.setViewport({ width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.scale });
    // Every request the page makes is checked: the browser reaches public sites only.
    await page.setRequestInterception(true);
    page.on("request", request => {
      void (async () => {
        try {
          const target = new URL(request.url());
          if (target.protocol === "data:" || target.protocol === "blob:") return request.continue();
          if (!/^https?:$/.test(target.protocol) || !(await publicHost(target.hostname))) return request.abort("blockedbyclient");
          return request.continue();
        } catch { return request.abort("blockedbyclient").catch(() => undefined); }
      })();
    });
    let status = 0;
    try {
      const response = await page.goto(url.href, { waitUntil: "networkidle2", timeout: 35_000 });
      status = response?.status() ?? 0;
    } catch {
      // A page that never goes quiet (ads, live prices) is taken as it is after its content is in.
      await page.waitForSelector("body", { timeout: 5_000 }).catch(() => undefined);
    }
    if (status >= 400) return { error: `сайт ответил ошибкой ${status}` };
    await new Promise(resolve => setTimeout(resolve, 1500));
    const title = await page.title().catch(() => "");
    const head = await page.evaluate(() => (document.body?.innerText ?? "").slice(0, 1500)).catch(() => "");
    if (GATE.test(title) || (head.length < 600 && GATE.test(head))) return { error: `вместо страницы — проверка или ошибка («${(title || head).slice(0, 60)}»)` };
    // Cookie banners, subscription pop-ups and dark overlays are hidden; a page that locks scrolling under them is unlocked.
    await page.evaluate(() => {
      if (!document.body) return;
      const area = innerWidth * innerHeight;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const style = getComputedStyle(el);
        if (style.position !== "fixed" && style.position !== "sticky") continue;
        const r = el.getBoundingClientRect();
        const text = (el.innerText || "").slice(0, 400);
        const consent = /cookie|consent|gdpr|куки|cookies|персональн|privacy|subscribe|подпиш|newsletter|accept all|принять/i.test(text + " " + el.id + " " + el.className);
        if (consent || r.width * r.height > area * 0.3) el.style.setProperty("display", "none", "important");
      }
      // A page that locks scrolling under a pop-up is unlocked the way it was before the pop-up.
      if (getComputedStyle(document.documentElement).overflowY === "hidden") document.documentElement.style.setProperty("overflow", "auto", "important");
      if (getComputedStyle(document.body).overflowY === "hidden") document.body.style.setProperty("overflow", "visible", "important");
    });
    let focus: { x: number; y: number; w: number; h: number } | null = null;
    if (find?.trim()) {
      const where = await page.evaluate(`(${FIND_PHRASE})(${JSON.stringify(find)})`) as { x: number; y: number; w: number; h: number } | null;
      if (where) {
        // The phrase stands in the upper third: what is above it gives context, the header of the site stays on top.
        const top = Math.max(0, where.y - VIEW.height * 0.3);
        await page.evaluate((y: number) => window.scrollTo(0, y), top);
        await new Promise(resolve => setTimeout(resolve, 900));
        const scrolled = await page.evaluate(() => scrollY);
        focus = { x: where.x, y: where.y - scrolled, w: where.w, h: where.h };
      } else {
        // The page is still real proof: it is shown from the top, unmarked, and Astra is told the phrase is not on it.
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    const png = await page.screenshot({ type: "png" });
    await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toFile(file);
    const stats = await sharp(png).greyscale().stats();
    const dark = (stats.channels[0]?.mean ?? 255) < 110;
    const m = await sharp(file).metadata();
    const s = VIEW.scale;
    const size: ScreenShot["size"] = { w: m.width ?? VIEW.width * s, h: m.height ?? VIEW.height * s, dark,
      ...(focus ? { focus: [Math.round(focus.x * s), Math.round(focus.y * s), Math.round(focus.w * s), Math.round(focus.h * s)] as [number, number, number, number] } : {}) };
    const shot = { size, title: title || url.hostname, ...(find?.trim() && !focus ? { missed: true } : {}) };
    fs.writeFileSync(meta, JSON.stringify(shot));
    return { file, ...shot };
  } catch (error) {
    return { error: `страница не открылась: ${String((error as Error).message).replace(/\s+/g, " ").slice(0, 160)}` };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** A screenshot that turned out wrong is removed, so the next montage takes the page again. */
export function discardScreen(rawUrl: string, find: string | undefined, dir: string): void {
  let url: URL;
  try { url = new URL(rawUrl.trim()); } catch { return; }
  const tag = createHash("sha1").update(`${url.href}#${find ?? ""}`).digest("hex").slice(0, 10);
  const file = path.join(dir, `${url.hostname.replace(/[^a-z0-9.-]/gi, "")}-${tag}.jpg`);
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.json`, { force: true });
}
