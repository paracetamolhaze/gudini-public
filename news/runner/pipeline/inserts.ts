// Вставки-наклейки: на словах про то, чего нет в роликах героя, поверх ролика на секунду появляется сама эта вещь,
// вырезанная из фона («расклад таро» — карты таро, «к ноябрю» — лист календаря). Владелец 28.10: «нужны вставки, даже
// про ведьму», потом: «обрезать и накладывать поверх, чуть уменьшить, не во весь экран, со звуком», «можно было просто
// карты таро вставить, а не генерировать с ведьмой, фоном». GPT рисует предмет на зелёном через мост картинок на этом ПК
// (127.0.0.1:43129, подписка), runner/py/cutout.py вырезает фон; не вышло — этой вставки просто нет.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { NewsPlan } from "../../engine/src/plan";
import { portrait } from "./photos";
import { memeCatalog, type Draft } from "./plan";
import { ffmpeg, mapLimit, MEDIA_ROOT, python, run, type Hooks } from "./util";

type Insert = NonNullable<NewsPlan["inserts"]>[number];

/** Сколько секунд картинка в кадре; фото человека — чуть дольше, чтобы узнать его. */
const INSERT_SECONDS = 1.1;
const PHOTO_SECONDS = 1.4;
const MAX_INSERTS = 4;
/** Мост ставит задания в очередь с каруселями и «3Д»: ждём до получаса. */
const BRIDGE_MS = 31 * 60_000;

function generate(prompt: string): Promise<Buffer> {
  const token = process.env.CODEX_BRIDGE_TOKEN;
  if (!token) return Promise.reject(new Error("нет CODEX_BRIDGE_TOKEN для моста картинок"));
  const body = JSON.stringify({ prompt, aspectRatio: "9:16", references: [], mode: "generate" });
  const url = new URL("/image", process.env.CODEX_IMAGE_BRIDGE_URL || "http://127.0.0.1:43129");
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${token}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        clearTimeout(timer);
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { base64?: string; error?: string };
          if (res.statusCode !== 200 || !data.base64) reject(new Error(data.error || `мост картинок: код ${res.statusCode}`));
          else resolve(Buffer.from(data.base64, "base64"));
        } catch {
          reject(new Error("мост картинок ответил не JSON"));
        }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error("мост картинок не ответил за 31 минуту")), BRIDGE_MS);
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`мост картинок недоступен: ${e.message}`));
    });
    req.end(body);
  });
}

const prompt = (picture: string) =>
  `A single isolated subject for a sticker cut-out: ${picture}. ` +
  "Only this one thing, big and centred, photorealistic and sharp, on a perfectly flat solid pure green background (#00FF00) — " +
  "no scene, no table, no room, no floor, no shadow on the background, nothing green on the subject itself. " +
  "Text only if it is part of the thing itself (a word printed on it); otherwise no text, no watermark.";

/** Карточки поверх ролика, как в движке (engine/src/Main.tsx): ширина, высота и центр по высоте. */
const CARD: Record<NonNullable<Insert["kind"]>, { w: number; h: number; cy: number }> = {
  meme: { w: 700, h: 620, cy: 680 },
  photo: { w: 660, h: 880, cy: 590 },
  sticker: { w: 720, h: 820, cy: 580 },
  logo: { w: 300, h: 300, cy: 860 },
};

/** Кадр под словом line:word — тот план, что идёт в ролике в эту секунду (dt — сколько секунд после слова). */
function frameUnder(pub: string, plan: NewsPlan, line: string, word: number, dt: number): { file: string; at: number } | { still: string } | null {
  const words = plan.lines[line]?.words;
  if (!words?.[word]) return null;
  for (const seg of plan.segments) {
    if ("narr" in seg && seg.narr === line) {
      const k = [...seg.shots.keys()].reverse().find((i) => seg.shots[i].w <= word) ?? 0;
      const shot = seg.shots[k];
      if (shot.still) return { still: path.join(pub, shot.still) };
      if (!shot.clip || shot.phone) return null;
      // время плана — как в движке: смена на слове минус 0,05 с, план с endAt/maxAt сдвинут назад
      const start = shot.w === 0 ? 0 : words[shot.w].s - 0.05;
      const next = k + 1 < seg.shots.length ? words[seg.shots[k + 1].w].s - 0.05 : plan.lines[line].end + 0.12;
      const length = next - start;
      const at = shot.endAt !== undefined ? Math.max(0, shot.endAt - length) : shot.maxAt !== undefined ? Math.max(0, Math.min(shot.at ?? 0, shot.maxAt - length)) : (shot.at ?? 0);
      return { file: path.join(pub, plan.clips[shot.clip].file), at: at + Math.min(length - 0.05, words[word].s - start + dt) };
    }
    if ("dub" in seg) {
      const l = seg.lines.find((x) => x.id === line);
      if (l) return { file: path.join(pub, plan.clips[seg.dub].file), at: seg.from + l.at + words[word].s + dt };
    }
  }
  return null;
}

type Spot = { cx: number; cy: number; scale: number; name: string };

/**
 * Где встать карточке, чтобы не лечь на лицо. По ширине всегда по центру, по высоте — где свободно: в середине (как раньше),
 * над лицами или под ними (под субтитрами); на свободной полосе карточка может стать меньше, но не меньше 3/4. Свободного
 * места нет — в середине, пусть и на лицо (владелец 30.10: «в углу нельзя ставить… сверху место всё-таки было, если нету —
 * похуй, лепить на лицо, но если есть место — ставить туда, главное по центру»). Без лиц или без кадра — как было.
 */
async function cardSpot(dir: string, pub: string, plan: NewsPlan, x: Insert, hooks: Hooks): Promise<Spot | undefined> {
  const card = CARD[x.kind ?? "sticker"];
  // вещь-наклейка — крупно по центру, даже поверх лица: она держится секунду, и смотрят на неё (владелец 1.11 о
  // бутылке Хеннесси: «маленькая и снизу, хотя можно в центр поставить»)
  if ((x.kind ?? "sticker") === "sticker") return { cx: 540, cy: card.cy, scale: 1.12, name: "по центру" };
  const under = frameUnder(pub, plan, x.line, x.w, x.dur / 2);
  if (!under) return undefined;
  const frame = "still" in under ? under.still : path.join(dir, `under_${x.line}_${x.w}.jpg`);
  try {
    if ("file" in under) await ffmpeg(["-ss", under.at.toFixed(3), "-i", under.file, "-frames:v", "1", "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", "-q:v", "3", frame], hooks.signal);
    const out = (await python("faces.py", [frame], hooks.signal)).trim().split("\n");
    const faces = JSON.parse(out[out.length - 1]) as [number, number, number, number][];
    if (!faces.length) return undefined;
    const hit = (s: Spot) => {
      const [hw, hh] = [(card.w * s.scale) / 2, (card.h * s.scale) / 2];
      const [x0, y0, x1, y1] = [s.cx - hw, s.cy - hh, s.cx + hw, s.cy + hh];
      return faces.reduce((a, [fx, fy, fw, fh]) => a + Math.max(0, Math.min(x1, fx + fw) - Math.max(x0, fx)) * Math.max(0, Math.min(y1, fy + fh) - Math.max(y0, fy)), 0);
    };
    const middle: Spot = { cx: 540, cy: card.cy, scale: 1, name: "" };
    if (!hit(middle)) return undefined;
    // свободные полосы по высоте: над самым верхним лицом и под самым нижним, но не на строке субтитров (1040–1160 px)
    const top = Math.min(...faces.map((f) => f[1]));
    const bottom = Math.max(...faces.map((f) => f[1] + f[3]));
    const band = (y0: number, y1: number, name: string): Spot | null => {
      const scale = Math.min(1, (y1 - y0) / card.h);
      return scale >= 0.75 ? { cx: 540, cy: Math.round((y0 + y1) / 2), scale: Number(scale.toFixed(2)), name } : null;
    };
    const free = [band(50, Math.min(top - 30, 1020), "над лицом"), band(Math.max(bottom + 30, 1190), 1880, "под лицом, ниже субтитров")]
      .filter((s): s is Spot => s !== null && !hit(s))
      .sort((a, b) => b.scale - a.scale)[0];
    if (!free) return undefined;
    hooks.log(`${x.kind ?? "вставка"} ${x.line}:${x.w} — ${free.name}, мимо лица`);
    return free;
  } catch (error) {
    hooks.log(`лица под ${x.line}:${x.w} не нашлись: ${(error as Error).message}`);
    return undefined;
  }
}

/** Нарисованная GPT вещь на зелёном — по тексту картинки, чтобы её можно было нарисовать заранее, до голоса. */
const greenFile = (dir: string, picture: string) => path.join(dir, `g_${createHash("sha1").update(picture.trim()).digest("hex").slice(0, 12)}.green.png`);

/**
 * Вещи-наклейки рисуются сразу после сценария — пока озвучивается текст или ещё в заготовке (владелец 1.11: «может
 * параллельно всё делать?»); makeInserts потом только вырезает фон и ставит их на места.
 */
export async function warmStickers(workDir: string, draft: Pick<Draft, "inserts">, hooks: Hooks): Promise<void> {
  const wanted = (draft.inserts ?? []).filter((x) => x.picture?.trim()).slice(0, MAX_INSERTS);
  if (!wanted.length) return;
  const dir = path.join(workDir, "inserts");
  fs.mkdirSync(dir, { recursive: true });
  await mapLimit(wanted, 2, async (x) => {
    const raw = greenFile(dir, x.picture);
    if (fs.existsSync(raw)) return;
    try {
      fs.writeFileSync(raw, await generate(prompt(x.picture)));
    } catch (error) {
      hooks.log(`вставка «${x.picture}» заранее не нарисовалась: ${(error as Error).message}`);
    }
  });
}

/** Слово занято владельцем в кадре: у него свои пару секунд. */
function nearPeek(plan: NewsPlan, line: string, word: number) {
  return (plan.peeks ?? []).some((p) => p.line === line && Math.abs(plan.lines[line].words[word].s - plan.lines[line].words[p.w].s) < p.dur + 0.2);
}

/** Цвет точки картинки: r, g, b, a. */
async function pixel(file: string, x: number, y: number): Promise<number[]> {
  const out = await new Promise<Buffer>((resolve, reject) =>
    execFile("ffmpeg", ["-v", "error", "-i", file, "-vf", `format=rgba,crop=1:1:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "-"], { encoding: "buffer", windowsHide: true }, (e, b) => (e ? reject(e) : resolve(b))),
  );
  return [...out.subarray(0, 4)];
}

/**
 * Сплошной фон значка — в прозрачность (владелец 1.11 о Tesla: «убрать у логотипов белую обводку и даже фон»):
 * у значка сайта фон обычно один цвет по всем краям (у X — чёрный квадрат, у многих — белый). Края разного цвета —
 * значок без сплошного фона, остаётся как есть.
 */
export async function clearBackground(file: string, w: number, h: number): Promise<void> {
  const spots = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [1, h >> 1], [w - 2, h >> 1], [w >> 1, 1], [w >> 1, h - 2]];
  const seen = (await Promise.all(spots.map(([x, y]) => pixel(file, x, y).catch(() => null)))).filter((p): p is number[] => !!p && p[3] > 200);
  // фон уже прозрачный (логотип с Викисклада): вырезать нечего, только тёмный знак светлеет
  if (seen.length < 4) return whitenDark(file, file);
  const [r, g, b] = [0, 1, 2].map((k) => Math.round(seen.reduce((a, p) => a + p[k], 0) / seen.length));
  if (seen.some((p) => Math.abs(p[0] - r) + Math.abs(p[1] - g) + Math.abs(p[2] - b) > 36)) return;
  // цветной фон — часть знака (зелёная сова Duolingo, синий Alipay): значок остаётся плиткой, иначе от него остаются
  // глаза и контур (владелец 2.11: «логотипы плохо вырезал»); вырезается только белый и чёрный фон
  if (Math.max(r, g, b) - Math.min(r, g, b) > 40) return;
  const hex = [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  const keyed = `${file}.keyed.png`;
  await ffmpeg(["-i", file, "-vf", `format=rgba,colorkey=0x${hex}:0.16:0.06`, keyed]);
  await whitenDark(keyed, file);
  fs.rmSync(keyed, { force: true });
}

/** Тёмный бесцветный знак из src пишется в out белым, остальные — как есть. */
async function whitenDark(keyed: string, file: string): Promise<void> {
  // тёмный бесцветный знак (X у SpaceX, яблоко Apple) на тёмном кадре пропал бы — он становится белым, как такие
  // логотипы и ставят на тёмное; цветные знаки остаются своего цвета
  const mean = await new Promise<Buffer>((resolve, reject) =>
    execFile("ffmpeg", ["-v", "error", "-i", keyed, "-vf", "format=rgba,scale=16:16", "-frames:v", "1", "-f", "rawvideo", "-"], { encoding: "buffer", windowsHide: true }, (e, out) => (e ? reject(e) : resolve(out))),
  );
  const opaque = [...Array(mean.length >> 2).keys()].map((i) => [...mean.subarray(i * 4, i * 4 + 4)]).filter((p) => p[3] > 160);
  const light = opaque.reduce((a, p) => a + 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2], 0) / Math.max(1, opaque.length);
  const colour = opaque.reduce((a, p) => a + Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]), 0) / Math.max(1, opaque.length);
  if (opaque.length && light < 70 && colour < 40) {
    const tmp = `${file}.white.png`;
    await ffmpeg(["-i", keyed, "-vf", "format=rgba,lutrgb=r=negval:g=negval:b=negval", tmp]);
    fs.renameSync(tmp, file);
  } else if (keyed !== file) fs.copyFileSync(keyed, file);
}

const WIKI_UA = { "User-Agent": "gudini-news-runner/1.0 (short news videos)" };

/**
 * Настоящий логотип бренда из Викиданных (свойство P154 — файл логотипа на Викискладе, обычно SVG): Викисклад отдаёт
 * его PNG с прозрачным фоном, фон вырезать не нужно (владелец 2.11 об Apple Duo: «логотипы плохо вырезал, плохо очень» —
 * значки сайтов теряли при вырезании зелёную сову Duolingo и синий фон Alipay). Из найденных по имени берётся тот, чей
 * официальный сайт (P856) — домен бренда.
 */
async function wikiLogo(brand: string, host: string, out: string): Promise<{ w: number; h: number } | null> {
  const api = "https://www.wikidata.org/w/api.php?format=json&origin=*";
  const found = (await (await fetch(`${api}&action=wbsearchentities&language=en&limit=6&search=${encodeURIComponent(brand)}`, { headers: WIKI_UA, signal: AbortSignal.timeout(20_000) })).json()) as { search?: { id: string }[] };
  const ids = (found.search ?? []).map((s) => s.id);
  if (!ids.length) return null;
  const got = (await (await fetch(`${api}&action=wbgetentities&props=claims&ids=${ids.join("|")}`, { headers: WIKI_UA, signal: AbortSignal.timeout(20_000) })).json()) as {
    entities?: Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> }>;
  };
  const site = host.replace(/^www\./, "");
  const items = ids.map((id) => got.entities?.[id]?.claims ?? {}).map((c) => ({
    logo: c.P154?.[0]?.mainsnak?.datavalue?.value as string | undefined,
    own: (c.P856 ?? []).some((s) => String(s.mainsnak?.datavalue?.value ?? "").toLowerCase().includes(site)),
  }));
  const pick = items.find((x) => x.logo && x.own) ?? items.find((x) => x.logo);
  if (!pick?.logo) return null;
  const res = await fetch(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(pick.logo.replace(/ /g, "_"))}?width=600`, { headers: WIKI_UA, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  const [w, h] = (await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", out])).stdout.trim().split(",").map(Number);
  if (!(w >= 64 && h >= 32)) return null;
  // у логотипа на Викискладе фон обычно прозрачный; белый фон (JPEG, PNG без прозрачности) вырезается как раньше
  await clearBackground(out, w, h);
  return { w, h };
}

/**
 * Логотип бренда — значок его сайта: сначала apple-touch-icon (обычно 180 px), иначе значок из поиска Google (до 256 px).
 * Меньше 32 px — это заглушка-глобус, логотипа нет. Это запасной путь, когда логотипа нет в Викиданных.
 */
export async function brandLogo(brand: string, domain: string, out: string): Promise<{ w: number; h: number } | null> {
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const svg = await wikiLogo(brand, host, out).catch(() => null);
  if (svg) return svg;
  for (const url of [`https://${host}/apple-touch-icon.png`, `https://www.google.com/s2/favicons?domain=${host}&sz=256`]) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      const [w, h] = (await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", out])).stdout.trim().split(",").map(Number);
      // значок мельче 96 px на карточке 280 px выходит мылом (2.11, Alipay 32 px) — лучше без логотипа
      if (w >= 96 && h >= 96) {
        await clearBackground(out, w, h);
        return { w, h };
      }
    } catch {
      // следующий источник
    }
  }
  fs.rmSync(out, { force: true });
  return null;
}

/**
 * Время в ролике, как в движке (engine/src/Main.tsx layout): где начинается каждая реплика и где кадры с картинкой
 * (карточка просмотров, стоп-кадр) под словами автора.
 */
function timeline(plan: NewsPlan): { lineAt: Map<string, number>; pictures: number[] } {
  const lineAt = new Map<string, number>();
  const pictures: number[] = [];
  let t = 0;
  plan.segments.forEach((seg, i) => {
    const last = i === plan.segments.length - 1;
    if ("narr" in seg) {
      lineAt.set(seg.narr, t);
      const words = plan.lines[seg.narr].words;
      for (const sh of seg.shots) if (sh.phone || sh.still) pictures.push(t + (sh.w === 0 ? 0 : words[sh.w].s - 0.05));
      t += plan.lines[seg.narr].end + (last ? 0.25 : 0.12);
    } else if ("orig" in seg) t += seg.to - seg.from;
    else {
      for (const l of seg.lines) lineAt.set(l.id, t + l.at);
      t += Math.max(seg.to - seg.from, Math.max(...seg.lines.map((l) => l.at + plan.lines[l.id].end)) + (last ? 0.25 : 0.37));
    }
  });
  return { lineAt, pictures: pictures.sort((a, b) => a - b) };
}

/** Слова, которые связывают бренды перечисления: «McDonald's, Duolingo, Red Bull и даже сам TikTok». */
const LIST_GLUE = new Set(["", "и", "а", "или", "and", "&", "даже", "сам", "сама", "само", "сами", "ещё", "еще", "тоже", "также", "плюс"]);

/** Стопка логотипов: каждый следующий чуть в стороне и выше предыдущего, наклон то влево, то вправо. */
const PILE = [
  { dx: 0, dy: 0 },
  { dx: 150, dy: -70 },
  { dx: -140, dy: -120 },
  { dx: 90, dy: -200 },
  { dx: -70, dy: -250 },
  { dx: 160, dy: -310 },
  { dx: -160, dy: -350 },
  { dx: 30, dy: -400 },
];
/**
 * Три-четыре логотипа — сеткой два в ряд, каждый виден целиком (3.11, Bitget, MEXC, HTX и KuCoin: в стопке крупный значок
 * Bitget закрыл MEXC и HTX, а вся стопка легла на лицо блогера).
 */
const GRID = [
  { dx: -240, dy: -110 },
  { dx: 240, dy: -110 },
  { dx: -240, dy: 210 },
  { dx: 240, dy: 210 },
];
const GRID_THREE = [GRID[0], GRID[1], { dx: 0, dy: 210 }];

export async function makeInserts(workDir: string, pub: string, plan: NewsPlan, draft: Pick<Draft, "inserts" | "memes" | "people" | "logos">, hooks: Hooks): Promise<void> {
  delete plan.inserts;
  const made: NonNullable<NewsPlan["inserts"]> = [];
  // мемы — готовые картинки из news/memes, карточкой поверх ролика
  const catalog = new Map(memeCatalog().map((m) => [m.id, m]));
  for (const m of draft.memes ?? []) {
    const meme = catalog.get(m.meme);
    if (!meme || !plan.lines[m.line]?.words[m.word] || nearPeek(plan, m.line, m.word)) continue;
    fs.mkdirSync(path.join(pub, "memes"), { recursive: true });
    const src = path.join(MEDIA_ROOT, "memes", meme.file);
    fs.copyFileSync(src, path.join(pub, "memes", meme.file));
    // свой размер картинки: движок растягивает мем до карточки, маленькие шаблоны (300×300) не остаются марками
    const [iw, ih] = (await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", src])).stdout.trim().split(",").map(Number);
    made.push({ line: m.line, w: m.word, file: `memes/${meme.file}`, dur: INSERT_SECONDS, kind: "meme", ...(iw > 0 && ih > 0 ? { iw, ih } : {}) });
    hooks.log(`мем ${m.line}:${m.word} — ${meme.name} (${m.why})`);
  }
  // знаменитости (фото из Википедии, photos.ts) и наклейки (GPT) — разом: друг от друга не зависят
  const people = (draft.people ?? []).slice(0, 2).filter((p) => plan.lines[p.line]?.words[p.word] && p.name?.trim() && !nearPeek(plan, p.line, p.word));
  const wanted = (draft.inserts ?? []).filter((x) => plan.lines[x.line]?.words[x.word] && x.picture?.trim() && !nearPeek(plan, x.line, x.word)).slice(0, MAX_INSERTS);
  const dir = path.join(workDir, "inserts");
  if (people.length) fs.mkdirSync(path.join(pub, "photos"), { recursive: true });
  if (wanted.length) {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(pub, "inserts"), { recursive: true });
    await hooks.step(`Рисуем вставки: ${wanted.length}`, 69);
  }
  const photos = mapLimit(people, 2, async (p, i): Promise<Insert | null> => {
    try {
      // о ком речь — фраза автора, где его называют: по ней ищется его фото в интернете, если нет статьи и лица на аватаре
      const got = await portrait(p.name, path.join(pub, "photos", `p${i + 1}.jpg`), hooks.signal, plan.lines[p.line].words.map((w) => w.w).join(" "));
      hooks.log(`фото ${p.line}:${p.word} — ${p.name} (${got.credit})`);
      return { line: p.line, w: p.word, file: `photos/p${i + 1}.jpg`, dur: PHOTO_SECONDS, kind: "photo", credit: got.credit, ...(got.w > 0 && got.h > 0 ? { iw: got.w, ih: got.h } : {}) };
    } catch (error) {
      hooks.log(`фото «${p.name}» не нашлось: ${(error as Error).message}`);
      return null;
    }
  });
  const stickers = mapLimit(wanted, 2, async (x, i): Promise<Insert | null> => {
    const raw = greenFile(dir, x.picture);
    const file = path.join(dir, `i${i + 1}.png`);
    try {
      if (!fs.existsSync(raw)) fs.writeFileSync(raw, await generate(prompt(x.picture)));
      const cut = JSON.parse(await python("cutout.py", [raw, file], hooks.signal)) as { share: number };
      if (!(cut.share > 0.03)) throw new Error("фон не вырезался");
      fs.copyFileSync(file, path.join(pub, "inserts", `i${i + 1}.png`));
      hooks.log(`вставка ${x.line}:${x.word} — ${x.picture}`);
      return { line: x.line, w: x.word, file: `inserts/i${i + 1}.png`, dur: INSERT_SECONDS, kind: "sticker" };
    } catch (error) {
      hooks.log(`вставка «${x.picture}» не нарисовалась: ${(error as Error).message}`);
      return null;
    }
  });
  for (const x of [...(await photos), ...(await stickers)]) if (x) made.push(x);
  // карточка — мимо лиц на кадре под ней
  fs.mkdirSync(dir, { recursive: true });
  for (const x of made) {
    const spot = await cardSpot(dir, pub, plan, x, hooks);
    if (spot) Object.assign(x, { cx: spot.cx, cy: spot.cy, ...(spot.scale !== 1 ? { scale: spot.scale } : {}) });
  }
  // логотипы брендов: каждый на своём слове, все в одной стопке, пока звучит перечисление — и через реплики тоже (владелец
  // 31.10: «все бренды должны были вместе быть, почему их разделили на 2 части?»); стопка уходит до кадра с картинкой
  // (карточка просмотров, стоп-кадр), а не закрывает его («на 6 сек остались 2 бренда и перекрывают картинку»)
  const logos = (draft.logos ?? []).filter((x) => plan.lines[x.line]?.words[x.word] && x.domain?.trim()).slice(0, 8);
  if (logos.length) fs.mkdirSync(path.join(pub, "logos"), { recursive: true });
  const tl = timeline(plan);
  const found: { x: (typeof logos)[number]; file: string; w: number; h: number; t: number; lineEnd: number }[] = [];
  for (const [i, x] of logos.entries()) {
    const file = `logos/l${i + 1}.png`;
    const size = await brandLogo(x.brand ?? "", x.domain, path.join(pub, file));
    if (!size) {
      hooks.log(`логотип ${x.brand} (${x.domain}) не нашёлся`);
      continue;
    }
    const line = plan.lines[x.line];
    const start = tl.lineAt.get(x.line) ?? 0;
    found.push({ x, file, w: size.w, h: size.h, t: start + line.words[x.word].s, lineEnd: start + line.end + 0.15 });
  }
  found.sort((a, b) => a.t - b.t);
  // стопка — только у перечисления: бренды подряд через запятую или «и» («McDonald's, Duolingo, Red Bull и TikTok»), и оно
  // может перейти в следующую реплику. Бренд, названный по ходу, — один логотип: уходит, как кончилась его фраза, а
  // следующий встаёт на его место (владелец 1.11: TikTok и ChatGPT легли стопкой и долго висели, «перечисления нет»;
  // логотип Claude держался, пока не выскочил Minecraft)
  const listed = (a: (typeof found)[number], b: (typeof found)[number]) => {
    if (a.x.line !== b.x.line || b.x.word <= a.x.word) return false;
    const words = plan.lines[a.x.line].words;
    for (let k = a.x.word + a.x.brand.trim().split(/\s+/).length; k < b.x.word; k++) {
      if (!LIST_GLUE.has(words[k].w.toLowerCase().replace(/[^\p{L}&]/gu, ""))) return false;
    }
    return true;
  };
  const groups: (typeof found)[] = [];
  for (const f of found) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    if (prev && (listed(prev, f) || (g.length >= 2 && f.t - prev.t < 3))) g.push(f);
    else groups.push([f]);
  }
  for (const [gi, g] of groups.entries()) {
    const lastT = g[g.length - 1].t;
    let end = Math.max(...g.map((f) => f.lineEnd));
    if (g.length === 1) {
      // одиночный логотип — до конца своей фразы (слово с точкой, двоеточием, запятой), но не меньше 0,9 с и не больше 1,8 с
      const f = g[0];
      const words = plan.lines[f.x.line].words;
      const start = tl.lineAt.get(f.x.line) ?? 0;
      let k = f.x.word + f.x.brand.trim().split(/\s+/).length - 1;
      while (k < words.length - 1 && !/[.,:;!?…»)]$/.test(words[k].w)) k++;
      end = Math.min(f.t + 1.8, Math.max(f.t + 0.9, start + words[Math.min(k, words.length - 1)].e + 0.2));
    }
    // следующий логотип встаёт на место этого
    const next = groups[gi + 1]?.[0];
    if (next && next.t < end) end = next.t - 0.02;
    const pic = tl.pictures.find((p) => p > lastT + 0.3 && p < end);
    if (pic !== undefined) end = pic - 0.05;
    g.forEach((f, k) => {
      const p = g.length === 3 ? GRID_THREE[k] : g.length === 4 ? GRID[k] : PILE[k % PILE.length];
      made.push({ line: f.x.line, w: f.x.word, file: f.file, dur: Number(Math.max(g.length === 1 ? 0.4 : 0.8, end - f.t).toFixed(2)), kind: "logo", iw: f.w, ih: f.h, cx: 540 + p.dx, cy: 900 + p.dy, rot: k % 2 ? 7 : -6 });
      hooks.log(`логотип ${f.x.line}:${f.x.word} — ${f.x.brand} (${f.w}×${f.h}), ${g.length === 3 || g.length === 4 ? "в сетке" : "в стопке"} ${k + 1}-й до ${end.toFixed(2)} с`);
    });
  }
  if (!made.length) return;
  holdBeforeMeme(plan, made, hooks);
  plan.inserts = made;
}

/**
 * Вещь на последних словах реплики, за которой сразу видеомем, — на своём слове: реплика держит кадр, пока вещь видна
 * секунду, и видеомем начинается после неё (владелец 1.11 о «Зондбе»: «хеннесси вышло раньше, чем сказали»; раньше её
 * сдвигали на слова раньше, чтобы видеомем её не срезал).
 */
function holdBeforeMeme(plan: NewsPlan, made: Insert[], hooks: Hooks): void {
  plan.segments.forEach((seg, i) => {
    const next = plan.segments[i + 1];
    if (!("narr" in seg) || !next || !("orig" in next) || !next.orig.startsWith("vm_")) return;
    const line = plan.lines[seg.narr];
    const need = Math.max(...made.filter((x) => x.line === seg.narr && x.kind !== "meme").map((x) => line.words[x.w].s + Math.min(x.dur, 1.1) - 0.12), line.end);
    if (need - line.end < 0.05) return;
    hooks.log(`${seg.narr}: кадр держится ещё ${(need - line.end).toFixed(2)} с — вещь на последних словах видна до видеомема`);
    line.end = Number(need.toFixed(3));
  });
}
