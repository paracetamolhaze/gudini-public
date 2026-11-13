// Шаг 5: план монтажа из черновика, голосов и роликов, папка задания и рендер движком news/engine.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import os from "node:os";
import type { Hit, Look, NewsPlan, Segment } from "../../engine/src/plan";
import { DARK, windowBrightness, type ClipInfo } from "./analyze";
import { flashes } from "./cuts";
import { on } from "./features";
import { videoMemeCatalog, type Draft } from "./plan";
import { checkRender } from "./qc";
import { prepareSounds } from "./sounds";
import { duration, ffmpeg, loudness, MEDIA_ROOT, NEWS_ROOT, readJson, run, writeJson, type Hooks } from "./util";
import type { VoicedLine } from "./voice";

const ENGINE = path.join(NEWS_ROOT, "engine");
const VOICE_LUFS = -15.5;
// субтитры выше, когда внизу кадра надпись или скриншот
/** Строка субтитров обычно здесь (engine/src/Main.tsx SUB_LOW); выше — когда внизу кадра свой текст. */
const SUB_LOW = 1040;
const SUB_HIGH = 840;
const ACCENT: Record<Draft["accents"][number]["kind"], Omit<Hit, "line" | "w">> = {
  kick: { kick: 0.06 },
  glitch: { kick: 0.07, sfx: "glitch" },
  boom: { kick: 0.09, shake: true, sfx: "boom" },
  cash: { kick: 0.06, sfx: "cash" },
};

const lineLen = (l: VoicedLine) => l.end + 0.12;

/**
 * Где встать субтитрам на картинке (пост, скриншот): в пустую полосу фона под ней, а если там тесно — над ней.
 * На середине они закрывали сам текст поста (30.10, Binance-2: «ноутбука» поверх «engineer's laptop»).
 * Без места — undefined, как обычно.
 */
async function stillSubY(file: string): Promise<number | undefined> {
  const W = 108;
  const H = 192;
  const frame = await new Promise<Buffer>((resolve, reject) =>
    execFile("ffmpeg", ["-v", "error", "-i", file, "-frames:v", "1", "-vf", `scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"], { encoding: "buffer", maxBuffer: 1 << 20, windowsHide: true }, (e, out) => (e ? reject(e) : resolve(out))),
  ).catch(() => null);
  if (!frame || frame.length < W * H) return undefined;
  const bg = frame[0];
  const busy = (y: number) => { for (let x = 0; x < W; x++) if (Math.abs(frame[y * W + x] - bg) > 8) return true; return false; };
  let top = 0;
  while (top < H && !busy(top)) top++;
  let bottom = H - 1;
  while (bottom > top && !busy(bottom)) bottom--;
  if (top >= H) return undefined;
  const scale = 1920 / H;
  const [y0, y1] = [top * scale, (bottom + 1) * scale];
  // строка субтитров — до 100 px; внизу ниже 1720 их закрывает подпись площадки
  if (y1 + 50 + 100 <= 1720) return Math.round(y1 + 50);
  if (y0 - 50 - 100 >= 220) return Math.round(y0 - 150);
  return undefined;
}

/** План для движка; файлы — относительно public-папки задания. Музыки в нём нет: трек под ролик кладёт сайт. */
export async function buildPlan(publicDir: string, draft: Draft, voices: Record<string, VoicedLine>, clips: ClipInfo[]): Promise<NewsPlan> {
  const byKey = new Map(clips.map((c) => [c.key, c]));
  const planClips: NewsPlan["clips"] = {};
  for (const c of clips) {
    // наложенные титры героя — под размытие (с запасом: Claude видит их на мелких кадрах и нижнюю строку часто занижает).
    // Русские (ru) остаются только в куске героя, где он сам говорит: там они и есть субтитры. Под словами автора и
    // переводом они шли вторым слоем под нашими (владелец 31.10 о Крузе: «субтитры авторши не замазал, почему?»)
    // каждый блок — своей полосой: заголовок IGN сверху и субтитры снизу одной полосой в две трети кадра не размывались
    // вовсе (владелец 3.11 о GTA: «почему текста у блогера не замазаны? слишком много шума»)
    const captions = c.moments.flatMap((m) =>
      (m.overlay ? m.textBoxes ?? (m.textBox ? [m.textBox] : []) : [])
        // полоса выше трети кадра — это уже не строка титров: размытие закрывало лицо и пол-кадра (31.10, казах 3–4 и 8–10 с)
        .filter((b) => b?.length === 2 && b[1] > b[0] && b[1] - b[0] <= 0.3)
        // посреди кадра — не строка титров: там размытие легло на номер машины и выглядело замазанным (владелец 5.11)
        .filter((b) => (b[0] + b[1]) / 2 < 0.3 || (b[0] + b[1]) / 2 > 0.62)
        .map((b) => ({ from: m.from, to: m.to, y0: Math.max(0, b[0] - 0.03), y1: Math.min(1, b[1] + 0.05), ...(m.lang === "ru" ? { ru: true } : {}) })),
    );
    planClips[c.key] = { file: `clips/${c.key}.mp4`, gain: Math.min(1, Math.pow(10, (VOICE_LUFS - c.loudness) / 20)), ...(captions.length ? { captions } : {}) };
  }
  fs.mkdirSync(path.join(publicDir, "stills"), { recursive: true });
  const stillY = new Map<string, number | undefined>();
  for (const c of clips) if (c.still) stillY.set(c.key, await stillSubY(path.join(publicDir, "clips", `${c.key}.mp4`)));
  const segments: Segment[] = [];
  // карточные промежутки клипа (runner/py/vertical.py → src/<key>.fit.json): горизонтальный план стоит карточкой на
  // 500–1108 px, титры (SUB_LOW) — под ней; поднятые subHigh титры ложились на карточку (5.11, GTA: «ноября» поверх даты)
  // fit.json: { spans, top, height } (7.11) или просто spans — тогда карточка прежняя, 500 px сверху высотой 608 (16:9)
  const fits = new Map<string, { spans: [number, number][]; bottom: number }>();
  for (const c of clips) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(path.dirname(publicDir), "src", `${c.key}.fit.json`), "utf8"));
      fits.set(c.key, Array.isArray(raw) ? { spans: raw, bottom: 1108 } : { spans: raw.spans ?? [], bottom: (raw.top ?? 400) + (raw.height ?? 608) });
    } catch {}
  }
  const cardAt = (key: string | undefined, at: number) => {
    const f = key ? fits.get(key) : undefined;
    return f && f.spans.some(([a, b]) => at + 0.3 >= a && at <= b) ? f : undefined;
  };
  const onCard = (key: string | undefined, at: number) => !!cardAt(key, at);
  // карточка доходит до строки субтитров (кадр 4:3, прежние карточки с 500 px) — субтитры сразу под ней, а не поверх
  const underCard = (key: string | undefined, at: number) => {
    const f = cardAt(key, at);
    return f && f.bottom + 24 > SUB_LOW ? Math.round(f.bottom + 30) : undefined;
  };
  const vmemes = new Map(videoMemeCatalog().map((v) => [v.id, v]));
  let firstShot = true;
  for (const s of draft.segments) {
    // видеомем — кусок со своим звуком (громкость нормирована при сборе библиотеки): поверх продолжающегося ролика, если
    // для него готовы обрезка и вырезка, иначе во весь экран, как кусок героя
    if (s.type === "vmeme") {
      const v = vmemes.get(s.meme);
      if (!v) continue;
      const lib = path.join(MEDIA_ROOT, "memes", "video");
      const key = `vm_${v.id}`;
      fs.mkdirSync(path.join(publicDir, "vmemes"), { recursive: true });
      // поверх ролика, без размытых полей и, где это люди, без фона (владелец 1.11; runner/py/vmeme_prep.py)
      if (on("vmemeOverlay") && v.crop && v.size && fs.existsSync(path.join(lib, v.crop))) {
        const crop = `vmemes/${v.id}.crop.mp4`;
        fs.copyFileSync(path.join(lib, v.crop), path.join(publicDir, crop));
        // мем-переход («A few moments later») — во весь экран, остальные — карточкой (владелец 2.11: карточки в роликах про
        // ChatGPT и Шакиру — «10 из 10», а вырезку внизу кадра он дважды отверг: «почему видео мем внизу снова»)
        planClips[key] = { file: crop, gain: 0.9, overlay: { w: v.size[0], h: v.size[1], ...(v.transition ? { transition: true } : {}) } };
        segments.push({ orig: key, from: 0, to: Number(Math.min(v.duration, await duration(path.join(publicDir, crop))).toFixed(2)) });
        continue;
      }
      const target = path.join(publicDir, "vmemes", v.file);
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(lib, v.file), target);
      planClips[key] = { file: `vmemes/${v.file}`, gain: 0.9 };
      segments.push({ orig: key, from: 0, to: Number(Math.min(v.duration, await duration(target)).toFixed(2)) });
      continue;
    }
    if (s.type === "orig") {
      const to = wholePhrase(byKey.get(s.clip), s.to);
      // перекрытия режиссёра (на словах о человеке — он сам) главнее; пустые места, которых они не касаются, — свои
      const chosen = (s.covers ?? []).filter((c) => byKey.has(c.clip)).map((c) => ({ from: Number((c.from - s.from).toFixed(2)), to: Number((c.to - s.from).toFixed(2)), at: c.at, clip: c.clip }));
      const covers = [...chosen, ...coverEmpty(byKey.get(s.clip), s.from, to).filter((e) => !chosen.some((c) => e.from < c.to && e.to > c.from))].sort((a, b) => a.from - b.from);
      segments.push({ orig: s.clip, from: s.from, to, ...(covers.length ? { covers } : {}) });
    }
    else if (s.type === "dub") {
      const clip = byKey.get(s.clip)!;
      // строки перевода не налезают друг на друга и укладываются в ролик
      const lines = [...s.lines].sort((a, b) => a.at - b.at).map((l) => ({ id: l.line, at: Math.max(0, l.at) }));
      for (let i = 1; i < lines.length; i++) lines[i].at = Math.max(lines[i].at, lines[i - 1].at + lineLen(voices[lines[i - 1].id]) + 0.1);
      const room = clip.duration - s.from;
      const last = lines[lines.length - 1];
      if (last && last.at + lineLen(voices[last.id]) > room) {
        const shift = last.at + lineLen(voices[last.id]) - room;
        for (const l of lines) l.at = Math.max(0, l.at - shift);
      }
      for (const l of lines) {
        const below = underCard(s.clip, s.from + l.at);
        if (below !== undefined) Object.assign(l, { subY: below });
      }
      segments.push({ dub: s.clip, from: s.from, to: Math.min(s.to, clip.duration), lines });
    } else {
      const shots = await Promise.all(s.shots.map(async (sh, k) => {
        const look: Look & { w: number } = { w: sh.word };
        // режиссёр бывает пишет still: true рядом с clip и at — это тот же стоп-кадр (4.11, Binance: монтаж падал на
        // «clips/undefined.mp4»)
        const loose = sh.still as unknown;
        const still = loose === true ? (sh.clip ? { clip: sh.clip, at: sh.at ?? 0 } : undefined) : sh.still && sh.still.clip ? sh.still : undefined;
        if (still) {
          const name = `stills/${still.clip}_${Math.round(still.at * 10)}.png`;
          const target = path.join(publicDir, name);
          if (!fs.existsSync(target)) await ffmpeg(["-ss", String(still.at), "-i", path.join(publicDir, "clips", `${still.clip}.mp4`), "-frames:v", "1", target]);
          look.still = name;
          look.focusY = 1300;
        } else {
          look.clip = sh.clip;
          look.at = sh.at ?? 0;
          look.maxAt = Math.max(0, (byKey.get(sh.clip!)?.duration ?? 1) - 0.1);
          if (sh.endAt !== undefined) look.endAt = sh.endAt;
          // телефон с просмотрами — только для настоящего ролика; снимок поста идёт во всю ширину (владелец 5.11: «почему
          // пост из х не на весь экран, он же вмещался»)
          if (sh.phone && !byKey.get(sh.clip!)?.still) look.phone = true;
        }
        if (sh.subHigh && !(look.clip && onCard(look.clip, look.at ?? 0))) look.subY = SUB_HIGH;
        else if (look.clip) {
          const below = underCard(look.clip, look.at ?? 0);
          if (below !== undefined) look.subY = below;
        }
        // на посте субтитры — в пустую полосу фона, мимо его текста
        // и стоп-кадром (still) тоже: на снимке комментариев субтитры шли поверх строк (31.10, стажёры)
        const card = stillY.get(still?.clip ?? sh.clip ?? "");
        if (card !== undefined) look.subY = card;
        if (firstShot && k === 0) {
          look.zoomFrom = 1.35;
          look.focusY = 760;
        } else if (k > 0 && (sh.phone || still)) look.sfx = "pop";
        return look;
      }));
      firstShot = false;
      segments.push({ narr: s.line, shots });
    }
  }
  const hits: Hit[] = (draft.accents ?? []).filter((a) => voices[a.line]).map((a) => ({ line: a.line, w: a.word, ...ACCENT[a.kind] }));
  const lines: NewsPlan["lines"] = {};
  for (const [id, v] of Object.entries(voices)) lines[id] = v;
  return { clips: planClips, lines, segments, hits, music: null, subLow: SUB_LOW, ...(draft.badge ? { badge: draft.badge } : {}) };
}

/** Папка, которую видит движок: ролики, голоса, звуки, вспышка, шрифт. */
export async function preparePublic(workDir: string, clips: ClipInfo[]): Promise<string> {
  const pub = path.join(workDir, "public");
  for (const d of ["clips", "vo", "sfx", "stills"]) fs.mkdirSync(path.join(pub, d), { recursive: true });
  for (const c of clips) {
    const target = path.join(pub, "clips", `${c.key}.mp4`);
    if (!fs.existsSync(target)) fs.copyFileSync(path.join(workDir, c.file), target);
  }
  for (const f of fs.readdirSync(path.join(workDir, "vo"))) fs.copyFileSync(path.join(workDir, "vo", f), path.join(pub, "vo", f));
  for (const d of ["fx", "fonts"]) fs.cpSync(path.join(ENGINE, "assets", d), path.join(pub, d), { recursive: true });
  return pub;
}

const STEP = 0.05;

/** Громкость звука клипа окнами по 50 мс начиная с start, dBFS. */
async function levels(file: string, start: number, length: number): Promise<number[]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-v", "info", "-ss", start.toFixed(3), "-t", length.toFixed(3), "-i", file, "-vn", "-af", "aresample=16000,asetnsamples=n=800,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"]);
  return [...stderr.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (Number.isFinite(parseFloat(m[1])) ? parseFloat(m[1]) : -100));
}

/**
 * Владелец 28.10 о ролике с вазелином: конец «на 1 сек лишний» (зацепил начало её следующей фразы), а без запаса
 * «она не успела договорить». Последний кусок с героем кончается в паузе сразу после её фразы: если на to она
 * ещё звучит, to сдвигается до первой тишины (не дальше 0,6 с). На тишине to не трогается — перемонтаж его не сдвигает.
 */
async function settleEnd(pub: string, plan: NewsPlan) {
  const seg = plan.segments[plan.segments.length - 1];
  if (!seg || "narr" in seg) return;
  const file = path.join(pub, plan.clips["orig" in seg ? seg.orig : seg.dub].file);
  const start = Math.max(seg.from, seg.to - 1.5);
  const lv = await levels(file, start, seg.to - start + 0.6);
  const quiet = Math.max(...lv) - 18;
  const at = Math.round((seg.to - start) / STEP);
  if (!(lv[at] >= quiet)) return;
  const gap = lv.findIndex((v, i) => i > at && v < quiet);
  if (gap > 0) seg.to = Number((start + (gap + 1) * STEP).toFixed(2));
}

/** Очередь монтажа: следующий ролик монтируется, когда отпустит предыдущий. */
let rendering = 0;
let renderChain: Promise<void> = Promise.resolve();
function renderTurn(): Promise<() => void> {
  rendering++;
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = () => {
    rendering--;
    resolve();
  }));
  const turn = renderChain.then(() => release);
  renderChain = renderChain.then(() => done);
  return turn;
}

/**
 * Ролик по плану без музыки: рендер Remotion, затем общая громкость −14 LUFS с ограничителем. Трек сайт кладёт под
 * него сам при выборе (lib/news/mix.ts) — владелец меняет треки сразу, без нового монтажа.
 */
export async function render(workDir: string, plan: NewsPlan, hooks: Hooks, progressFrom = 70): Promise<{ file: string; duration: number }> {
  const pub = path.join(workDir, "public");
  // владелец 28.10: «я хотел моментально менять треки и проверять какие подойдут, а не ждать перемонтажа»
  plan.music = null;
  fs.rmSync(path.join(pub, "music"), { recursive: true, force: true });
  // владельца в кадре больше нет — и в перемонтаже старых планов (владелец 30.10: «моё всплытие нужно убрать вообще»)
  delete plan.peek;
  delete plan.peeks;
  // звуки — свежие из news/sounds при каждом монтаже, в плане — только те, что есть
  plan.sounds = await prepareSounds(path.join(pub, "sfx"));
  // длина каждого клипа — движку: перебивка, которой не хватает клипа, начинается раньше, а не стоит стоп-кадром
  for (const c of Object.values(plan.clips)) {
    const len = await duration(path.join(pub, c.file)).catch(() => 0);
    if (len > 0) c.duration = Number(len.toFixed(2));
  }
  // логотип собирается на карточке (pixel2motion, 31.10) — выключатель в news/features.json; спокойный монтаж (calm)
  // переживает перемонтаж: его теряли, и посты Bitget снова «ехали вперёд» (владелец 3.11)
  // движение вставок по измеренным числам, приход к слову и притемнение вокруг обводки (11.11) — тоже выключатели
  plan.fx = { ...plan.fx, logoReveal: on("logoReveal"), motion: on("motion"), wordLead: on("wordSync"), focus: on("markFocus") };
  await settleEnd(pub, plan);
  writeJson(path.join(workDir, "plan.json"), plan);
  const require = createRequire(path.join(NEWS_ROOT, "node_modules", "x.js"));
  const { bundle } = require("@remotion/bundler") as typeof import("@remotion/bundler");
  const { renderMedia, selectComposition } = require("@remotion/renderer") as typeof import("@remotion/renderer");
  const raw = path.join(workDir, "render.mp4");
  // точечная правка (runner/edit.ts) пишет, какой отрезок изменился: монтируется только он, остальное берётся из прошлого
  // монтажа — правка в паре секунд идёт минуту, а не шесть (владелец 31.10: «чтобы … было быстро»)
  const windowFile = path.join(workDir, "edits", "window.json");
  const part = fs.existsSync(windowFile) && fs.existsSync(raw) ? readJson<{ from: number; to: number | null }>(windowFile) : null;
  // монтаж — по одному ролику: он занимает все ядра, два разом шли бы каждый вдвое дольше (index.ts делает ролики разом)
  if (rendering) await hooks.step("Ждём, пока смонтируется другой ролик", progressFrom);
  const release = await renderTurn();
  try {
    await hooks.step("Монтируем ролик", progressFrom);
    const serveUrl = await bundle({ entryPoint: path.join(ENGINE, "src", "index.ts"), publicDir: pub });
    const inputProps = { plan };
    // свой порт сервера кадров: «Опус 5.5» рендерит этим же движком в соседнем процессе, и на общем порту один процесс
    // получал картинки другого (5.11: «The source image cannot be decoded»)
    const port = process.env.NEWS_RENDER_PORT ? Number(process.env.NEWS_RENDER_PORT) : undefined;
    const composition = await selectComposition({ serveUrl, id: "News", inputProps, ...(port ? { port } : {}) });
    const frames = composition.durationInFrames;
    const f0 = part ? Math.max(0, Math.floor(part.from * 30)) : 0;
    // длина ролика изменилась (вырезали видеомем, переозвучили реплику) — прошлый монтаж после отрезка уже не совпадает
    // с планом: монтируется всё до конца, иначе в ролик приклеивался хвост старой версии (4.11: у такси и Fallout
    // после новой концовки шли ещё 3–4 секунды старой)
    const sameLength = part ? Math.abs((await duration(raw)) * 30 - frames) <= 2 : true;
    const f1 = part && part.to !== null && sameLength ? Math.min(frames - 1, Math.ceil(part.to * 30)) : frames - 1;
    const piece = path.join(workDir, "edits", "part.mp4");
    let last = 0;
    await renderMedia({
      serveUrl, composition, inputProps, codec: "h264", outputLocation: part ? piece : raw, concurrency: renderThreads(), ...(port ? { port } : {}),
      // кадр ролика героя грузится дольше 30 с, когда рядом качают и разбирают другие ролики (2.11: львица упала на
      // «delayRender Fetching …c2.mp4», пока шли 4 задания разом)
      timeoutInMilliseconds: 180_000,
      ...(part ? { frameRange: [f0, f1] as [number, number] } : {}),
      onProgress: ({ progress }) => {
        const p = progressFrom + Math.round(progress * (95 - progressFrom));
        if (p > last) {
          last = p;
          void hooks.step(`Монтируем ролик${part ? ` (${(f0 / 30).toFixed(1)}–${((f1 + 1) / 30).toFixed(1)} с)` : ""}: ${Math.round(progress * 100)}%`, p).catch(() => {});
        }
      },
    });
    if (part) {
      // прошлый монтаж до отрезка + новый отрезок + прошлый после него (если длина ролика не менялась)
      const head = `[0:v]trim=end_frame=${f0},setpts=PTS-STARTPTS[v0];[0:a]atrim=end=${(f0 / 30).toFixed(4)},asetpts=PTS-STARTPTS[a0];`;
      const mid = "[1:v]setpts=PTS-STARTPTS[v1];[1:a]asetpts=PTS-STARTPTS[a1];";
      const tail = part.to !== null && f1 + 1 < frames ? `[0:v]trim=start_frame=${f1 + 1},setpts=PTS-STARTPTS[v2];[0:a]atrim=start=${((f1 + 1) / 30).toFixed(4)},asetpts=PTS-STARTPTS[a2];` : "";
      const parts = [...(f0 > 0 ? ["[v0][a0]"] : []), "[v1][a1]", ...(tail ? ["[v2][a2]"] : [])];
      const graph = `${f0 > 0 ? head : ""}${mid}${tail}${parts.join("")}concat=n=${parts.length}:v=1:a=1[v][a]`;
      const joined = path.join(workDir, "edits", "joined.mp4");
      await ffmpeg(["-i", raw, "-i", piece, "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", joined], hooks.signal);
      fs.renameSync(joined, raw);
      fs.rmSync(windowFile, { force: true });
      hooks.log(`перемонтирован отрезок ${(f0 / 30).toFixed(2)}–${((f1 + 1) / 30).toFixed(2)} с, остальное из прошлого монтажа`);
    }
  } finally {
    release();
  }
  // план, по которому смонтирован ролик: с ним edit.ts сверяет следующую правку
  fs.mkdirSync(path.join(workDir, "edits"), { recursive: true });
  writeJson(path.join(workDir, "edits", "rendered.json"), plan);
  // вспышки чужих кадров в готовом ролике (tidyEdges должен был их убрать) — в журнал, чтобы видеть, если вернутся
  const flash = await flashes(raw, (await duration(raw)) - 0.5, hooks.signal).catch(() => []);
  if (flash.length) hooks.log(`короткие планы в ролике: ${flash.map((t) => t.toFixed(2)).join(", ")} с`);
  const gain = -14 - (await loudness(raw));
  const out = path.join(workDir, "out.mp4");
  await ffmpeg(["-i", raw, "-c:v", "copy", "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=0.93:level=disabled`, "-c:a", "aac", "-b:a", "192k", out], hooks.signal);
  // проверка готового ролика и свежий критик (qc.ts) — в фоне: ролик уходит на сайт, не дожидаясь их; копия — чтобы
  // загрузка или следующий монтаж не тронули файл, пока его смотрят
  const checked = path.join(workDir, "qc", "out.mp4");
  fs.mkdirSync(path.dirname(checked), { recursive: true });
  fs.copyFileSync(out, checked);
  void checkRender(workDir, checked, plan, hooks, !!part).catch((error: Error) => hooks.log(`проверка ролика не вышла: ${error.message}`));
  return { file: out, duration: await duration(out) };
}

/**
 * Пустые места внутри куска героя (между людьми, одни руки, голова за краем) — под кадром того же ролика без звука:
 * лучше всего кто-то слушает, вне куска, ближе по времени. Голос героя идёт дальше (владелец 30.10 про Пуговку: «видно
 * только промежуток между двумя людьми, разве он не видит, что монтирует»; в Болоте на 30 с — одно плечо у занавеса).
 */
function coverEmpty(c: ClipInfo | undefined, from: number, to: number): { from: number; to: number; at: number }[] {
  if (!c) return [];
  const holes: { a: number; b: number }[] = [];
  for (const m of [...c.moments].sort((x, y) => x.from - y.from)) {
    if (!m.empty) continue;
    const a = Math.max(from, m.from);
    const b = Math.min(to, m.to);
    if (b <= a) continue;
    const last = holes[holes.length - 1];
    if (last && a - last.b < 0.3) last.b = Math.max(last.b, b);
    else holes.push({ a, b });
  }
  const good = c.moments.filter((m) => !m.empty && m.to - m.from >= 0.8 && windowBrightness(c, m.from, m.to) >= DARK);
  const out: { from: number; to: number; at: number }[] = [];
  for (const { a, b } of holes) {
    if (b - a < 0.6) continue;
    const outside = (m: { from: number; to: number }) => m.to <= from || m.from >= to;
    const pick = [...good]
      .filter((m) => m.to <= a || m.from >= b)
      .sort((x, y) => Number(!!x.speaking) - Number(!!y.speaking) || Number(!outside(x)) - Number(!outside(y)) || Number(x.to - x.from < b - a) - Number(y.to - y.from < b - a) || Math.abs(x.from - a) - Math.abs(y.from - a))[0];
    if (!pick) continue;
    out.push({ from: Number((a - from).toFixed(2)), to: Number((a - from + Math.min(b - a, pick.to - pick.from)).toFixed(2)), at: pick.from });
  }
  return out;
}

/**
 * Конец куска героя — после последнего слова его фразы: расшифровка часто ставит конец фразы раньше, чем отзвучало
 * слово, и кусок обрывался на полуслове. Не дальше начала следующей фразы и конца ролика.
 */
function wholePhrase(clip: ClipInfo | undefined, to: number): number {
  if (!clip) return to;
  const next = clip.transcript.phrases.find((p) => p.s >= to - 0.05);
  const room = Math.min(next ? next.s - 0.05 : Infinity, clip.duration);
  return Math.max(to, Math.min(to + 0.25, room));
}

/**
 * Потоки монтажа: 10, но не больше доступных ядер — Remotion отказывает, если просить больше (29.10 владелец урезал
 * исполнитель до половины ядер, «чтобы дота не лагала», и монтаж падал на «Maximum for --concurrency is 6»).
 */
// считается при каждом монтаже: ядра исполнителю могут урезать уже после запуска
const renderThreads = () => Math.max(1, Math.min(Number(process.env.NEWS_RENDER_CONCURRENCY || 10), os.availableParallelism()));

/** Тот же ролик заново по его раскладке (после правки монтажа): план и папка задания остались от первого монтажа. */
export async function rerender(workDir: string, hooks: Hooks) {
  const planFile = path.join(workDir, "plan.json");
  if (!fs.existsSync(planFile)) throw new Error("Папки этого ролика на ПК нет — перемонтировать не из чего, создайте ролик заново");
  return render(workDir, readJson<NewsPlan>(planFile), hooks, 10);
}

/**
 * Чистый кадр для обложки: первый план ролика — по правилам режиссёра это самый яркий кадр истории с героем — прямо из
 * его ролика, без субтитров, вставок и заставки (владелец 3.11 выбрал обложку «настоящий кадр + белый заголовок»).
 * Секунда с небольшим от начала плана, не дальше его конца; стоп-кадр — как есть. null — плана нет.
 */
export async function coverFrame(workDir: string): Promise<string | null> {
  const planFile = path.join(workDir, "plan.json");
  if (!fs.existsSync(planFile)) return null;
  const plan = readJson<NewsPlan>(planFile);
  const first = plan.segments.find((s): s is Extract<Segment, { narr: string }> => "narr" in s);
  const shot = first?.shots[0];
  if (!shot) return null;
  const pub = path.join(workDir, "public");
  const out = path.join(workDir, "cover-frame.jpg");
  if (shot.still) {
    await ffmpeg(["-i", path.join(pub, shot.still), "-frames:v", "1", "-q:v", "2", out]);
    return out;
  }
  const clip = shot.clip ? plan.clips[shot.clip] : undefined;
  if (!clip) return null;
  const at = Math.max(0, Math.min((shot.at ?? 0) + 1.2, (shot.maxAt ?? (shot.at ?? 0) + 1.2) - 0.1));
  await ffmpeg(["-ss", at.toFixed(2), "-i", path.join(pub, clip.file), "-frames:v", "1", "-q:v", "2", out]);
  return fs.existsSync(out) ? out : null;
}
