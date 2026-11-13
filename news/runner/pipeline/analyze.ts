// Шаг 2: что в каждом ролике героя — речь по словам и что видно по времени (Claude смотрит листы кадров).
import fs from "node:fs";
import path from "node:path";
import { claudeJson } from "./llm";
import type { SourceClip } from "./story";
import { ffmpeg, hasAudio, hasVideo, loudness, mapLimit, python, readJson, run, writeJson, type Hooks } from "./util";

/** Сколько роликов героя разбирается разом: мост Claude берёт до трёх заданий (NEWS_CLAUDE_CONCURRENCY). */
const ANALYZE_AT_ONCE = 3;

export type Transcript = { language: string; probability: number; phrases: { s: number; e: number; text: string }[]; words: { w: string; s: number; e: number }[] };
/**
 * overlay — текст наложен поверх ролика (субтитры, подписи автора, стикеры), а не надпись в самой сцене; textBoxes — полосы
 * его блоков по высоте кадра, доли 0–1 сверху, каждый блок своей полосой (textBox — одна общая полоса старых разборов);
 * lang — язык текста. Чужие наложенные титры движок размывает.
 */
/** empty — в кадре нет главного: пустое место между людьми, одни руки или спины, головы срезаны краем. */
export type Moment = { from: number; to: number; shows: string; text?: string; textZone?: "top" | "middle" | "bottom" | "none"; overlay?: boolean; textBoxes?: [number, number][]; textBox?: [number, number]; lang?: string; speaking?: boolean; empty?: boolean };
/** brightness[i] — средняя яркость кадра (0..255) в момент i / 2 секунды. */
/** still — неподвижная картинка (пост, скриншот): показывается один раз и держится, пока о ней говорят. */
/** cuts — склейки ролика, секунды: между ними один план (кусок героя одним планом дольше 6 с — однообразно). */
export type ClipInfo = SourceClip & { transcript: Transcript; moments: Moment[]; loudness: number; brightness: number[]; still?: boolean; cuts?: number[] };

export const DARK = 45;

/** Яркость кадров дважды в секунду: тёмные куски (ночь, телефон экраном вниз) в кадр не ставятся. */
async function brightness(file: string, signal?: AbortSignal): Promise<number[]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vf", "fps=2,scale=96:-2,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG", "-an", "-f", "null", "-"], { signal });
  return [...stderr.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Math.round(Number(m[1])));
}

/** Неподвижен ли ролик целиком: стоп-кадр freezedetect на всю длину (карточка поста, скриншот). */
async function isStill(file: string, dur: number, signal?: AbortSignal): Promise<boolean> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vf", "fps=5,scale=160:-2,freezedetect=n=0.002:d=1", "-an", "-f", "null", "-"], { signal });
  const frozen = [...stderr.matchAll(/freeze_duration: ([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  // замер до конца ролика — картинка, только если он с самого начала: пост South Park с геймплеем GTA 6 (45,9 с) стоял
  // лишь последние 1,3 с, а считался картинкой — режиссёр не мог взять из него кусок, и сценарий переписывался по кругу (1.11)
  const tail = stderr.slice(stderr.lastIndexOf("freeze_start"));
  const lastStart = Number(tail.match(/freeze_start: ([\d.]+)/)?.[1] ?? Infinity);
  const open = /freeze_start/.test(stderr) && !/freeze_end/.test(tail) && lastStart <= Math.max(1, dur * 0.1);
  return open || frozen >= dur * 0.9;
}

/** Склейки ролика: смена кадра ffmpeg scene больше 0,3, не чаще раза в 0,4 с. */
export async function sceneCuts(file: string, signal?: AbortSignal): Promise<number[]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vf", "scale=160:-2,select='gt(scene,0.3)',showinfo", "-an", "-f", "null", "-"], { signal });
  const out: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([\d.]+)/g)) {
    const t = Number(Number(m[1]).toFixed(2));
    if (!out.length || t - out[out.length - 1] >= 0.4) out.push(t);
  }
  return out;
}

/** Склейки для роликов, разобранных до 30.10 (в clips.json их нет): досчитываются один раз и дописываются в разбор. */
export async function ensureCuts(workDir: string, clips: ClipInfo[], signal?: AbortSignal): Promise<void> {
  const missing = clips.filter((c) => !c.cuts && !c.still);
  if (!missing.length) return;
  await mapLimit(missing, ANALYZE_AT_ONCE, async (c) => {
    c.cuts = await sceneCuts(path.join(workDir, c.file), signal);
  });
  writeJson(path.join(workDir, "clips.json"), clips);
}

/** Средняя яркость окна ролика; без замера — как светлый кадр. */
export function windowBrightness(c: Pick<ClipInfo, "brightness">, from: number, to: number): number {
  const b = c.brightness ?? [];
  const part = b.slice(Math.max(0, Math.floor(from * 2)), Math.max(Math.floor(from * 2) + 1, Math.ceil(to * 2)));
  return part.length ? part.reduce((a, x) => a + x, 0) / part.length : 255;
}

const SHEET_SECONDS = 24; // 48 кадров через 0,5 с на лист
const FONT = (process.env.NEWS_FONT || "C:/Windows/Fonts/arialbd.ttf").replace(":", "\\:");

/** Листы кадров каждые 0,5 с с меткой времени в углу: так Claude видит, что и когда в ролике. */
async function sheets(file: string, dur: number, dir: string, key: string, signal?: AbortSignal): Promise<string[]> {
  const out: string[] = [];
  // хвост короче секунды листа не даёт: ролик в 24,1 с ронял ffmpeg на «листе» с 24 с (29.10, GTA 6 и IShowSpeed)
  for (let start = 0, i = 0; start === 0 || start < dur - 1; start += SHEET_SECONDS, i++) {
    const sheet = path.join(dir, `${key}_sheet${i}.jpg`);
    const vf = `fps=2,scale=180:-2,drawtext=fontfile='${FONT}':text='%{pts\\:hms}':x=4:y=4:fontsize=20:fontcolor=yellow:box=1:boxcolor=black@0.7,tile=8x6`;
    try {
      await ffmpeg(["-ss", String(start), "-t", String(SHEET_SECONDS), "-i", file, "-vf", vf, "-frames:v", "1", "-q:v", "4", sheet], signal);
    } catch (error) {
      // без последнего листа ролик всё равно разобран; без первого — нет
      if (start === 0 || signal?.aborted) throw error;
    }
    if (fs.existsSync(sheet)) out.push(sheet);
  }
  return out;
}

const VISION_SYSTEM = `Ты смотришь ролик героя для монтажа: перед тобой листы кадров через каждые 0,5 секунды, метка времени (часы:минуты:секунды от начала листа) в левом верхнем углу кадра. Первый лист начинается с 0 секунд, каждый следующий — на 24 секунды позже. Дана и расшифровка речи с таймингами.
Опиши ролик по отрезкам 1–3 секунды: что видно (кто, что делает, крупность, что в руках), какой текст на экране и в какой части кадра он стоит (top — верхняя треть, middle — середина, bottom — нижняя треть, none — нет текста), говорит ли герой в кадр. Время — в секундах от начала ролика.
Если текст наложен поверх ролика (субтитры, подписи, стикеры с текстом, которые добавил автор ролика), отметь overlay: true, полосы его блоков по высоте кадра textBoxes: [[верх, низ], …] в долях от 0 (верх кадра) до 1 (низ) — каждый блок своей полосой, с запасом на все его строки (заголовок сверху и субтитры снизу — две полосы, а не одна от заголовка до субтитров: между ними лицо), и язык lang («en», «ru»…). Надписи в самой сцене (вывеска, этикетка, экран телефона в кадре) — overlay: false.
Если в кадре нет ничего, на что стоит смотреть, — пустое место между людьми, одни руки, плечи или спины, головы срезаны краем кадра, картинка или вставка шоу срезана краем так, что её не разобрать (видна узкая полоска), — отметь empty: true: такой кадр в монтаж не ставится.
Ответ — только JSON: {"moments":[{"from":0,"to":2.5,"shows":"…","text":"надпись на экране или пусто","textZone":"top|middle|bottom|none","overlay":true,"textBoxes":[[0.12,0.2],[0.62,0.74]],"lang":"en","speaking":true,"empty":false}]}`;

/**
 * Расшифровок на ПК разом — не больше ANALYZE_AT_ONCE на все ролики: исполнитель делает ролики параллельно (1.11), а
 * каждый whisper держит модель в памяти.
 */
let whispering = 0;
const whisperQueue: (() => void)[] = [];
async function whisperTurn<T>(fn: () => Promise<T>): Promise<T> {
  while (whispering >= ANALYZE_AT_ONCE) await new Promise<void>((resolve) => whisperQueue.push(resolve));
  whispering++;
  try {
    return await fn();
  } finally {
    whispering--;
    whisperQueue.shift()?.();
  }
}

export async function analyzeClips(workDir: string, clips: SourceClip[], hooks: Hooks): Promise<ClipInfo[]> {
  const cached = path.join(workDir, "clips.json");
  if (fs.existsSync(cached)) return readJson<ClipInfo[]>(cached);
  const dir = path.join(workDir, "analysis");
  fs.mkdirSync(dir, { recursive: true });
  // ролики разбираются разом, по три: расшифровка на ПК и Claude по листам кадров идут параллельно
  let done = 0;
  await hooks.step(`Разбираем ролики героя: ${clips.length} разом`, 15);
  const parsed = await mapLimit(clips, ANALYZE_AT_ONCE, async (clip): Promise<ClipInfo | null> => {
    const file = path.join(workDir, clip.file);
    if (!(await hasVideo(file))) {
      hooks.log(`${clip.key} без видео (фото-пост) — пропущен`);
      return null;
    }
    const tr = path.join(dir, `${clip.key}.transcript.json`);
    // ролик без звуковой дорожки: речи в нём нет, расшифровывать нечего — он остаётся картинкой под слова автора
    if (!fs.existsSync(tr) && !(await hasAudio(file))) {
      hooks.log(`${clip.key} без звука — расшифровка не нужна`);
      writeJson(tr, { language: "ru", probability: 0, phrases: [], words: [] } satisfies Transcript);
    }
    // расшифровка зависала и падала по таймауту (5.11, Бразилия) — второй раз она обычно проходит
    if (!fs.existsSync(tr))
      await whisperTurn(() =>
        python("transcribe.py", [file, tr], hooks.signal, 900_000).catch((error) => {
          if (hooks.signal?.aborted) throw error;
          hooks.log(`${clip.key}: расшифровка не удалась (${String((error as Error).message).slice(0, 80)}) — ещё раз`);
          return python("transcribe.py", [file, tr], hooks.signal, 900_000);
        }),
      );
    const transcript = readJson<Transcript>(tr);
    const images = (await sheets(file, clip.duration, dir, clip.key, hooks.signal)).map((p) => ({ base64: fs.readFileSync(p).toString("base64"), mediaType: "image/jpeg" }));
    const speech = transcript.phrases.map((p) => `[${p.s}–${p.e}] ${p.text}`).join("\n") || "(речи нет)";
    let moments: Moment[] = [];
    try {
      const res = await claudeJson<{ moments: Moment[] }>(VISION_SYSTEM, `Ролик ${clip.key}, длительность ${clip.duration.toFixed(1)} с. Что в нём по описанию: ${clip.shows}\nЯзык речи: ${transcript.language}\nРечь:\n${speech}`, { images, task: `news-look ${clip.key}`, effort: "medium" });
      moments = (res.moments ?? []).filter((m) => Number.isFinite(m.from) && Number.isFinite(m.to));
    } catch (error) {
      hooks.log(`Claude не описал ${clip.key}: ${(error as Error).message}`);
    }
    const still = await isStill(file, clip.duration, hooks.signal);
    const info = { ...clip, transcript, moments, loudness: await loudness(file), brightness: await brightness(file, hooks.signal), still, ...(still ? {} : { cuts: await sceneCuts(file, hooks.signal) }) };
    await hooks.step(`Разбираем ролики героя: готово ${++done} из ${clips.length}`, 15 + Math.round((done / clips.length) * 20));
    return info;
  });
  const out = parsed.filter((c): c is ClipInfo => c !== null);
  writeJson(cached, out);
  return out;
}
