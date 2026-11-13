/**
 * Секунда видео — по его кадрам, а не по памяти: режиссёр называет ролик и примерный момент, здесь ролик качается
 * в низком качестве, режется на листы кадров с отметкой секунды, и Claude выбирает момент, где видно обещанное.
 * Проба 5.11: из шести кусков YouTube, взятых с секунды режиссёра, проверку прошли два — на остальных был не тот кадр.
 */
import fs from "node:fs";
import path from "node:path";
import { claudeJson } from "../pipeline/llm";
import { ffmpeg, run } from "../pipeline/util";

/** Короткий ролик смотрим целиком, длинный — окном вокруг секунды режиссёра. */
const WHOLE = 600;
const AROUND = 120;
const PER_SHEET = 20;
const MAX_FRAMES = 80;
const FONT = "C\\:/Windows/Fonts/arialbd.ttf";

async function videoLength(url: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const { stdout } = await run("yt-dlp", ["--no-warnings", "-q", "--no-playlist", "--print", "duration", url], { timeoutMs: 60_000, signal });
    const d = Number(stdout.trim().split("\n")[0]);
    return d > 0 ? d : null;
  } catch {
    return null;
  }
}

/**
 * Момент ролика: секунда начала куска длиной len, где видно what, и полоса кадра по высоте без плашек телеканала
 * (top–bottom, доли высоты): по ней кусок обрезается до вертикали. null — ролик не открылся или нужного в нём нет.
 */
export type Moment = { at: number; top: number; bottom: number };
export async function pickMoment(url: string, hint: number, len: number, what: string, dir: string, signal?: AbortSignal): Promise<Moment | null> {
  const total = await videoLength(url, signal);
  if (!total || total < len) return null;
  const from = total <= WHOLE ? 0 : Math.max(0, Math.min(hint - AROUND / 2, total - AROUND));
  const to = total <= WHOLE ? total : Math.min(total, from + AROUND);
  fs.mkdirSync(dir, { recursive: true });
  const low = path.join(dir, "low.mp4");
  fs.rmSync(low, { force: true });
  try {
    await run("yt-dlp", ["--no-warnings", "-q", "--no-playlist", "-f", "bv*[height<=360]/b[height<=360]/worst", "--download-sections", `*${from.toFixed(1)}-${to.toFixed(1)}`, "-o", low, url], { timeoutMs: 300_000, signal });
  } catch {
    return null;
  }
  if (!fs.existsSync(low)) return null;
  // кадр каждые step секунд, на кадре — его секунда в ролике; листы по 20 кадров
  const step = Math.max(2, Math.ceil((to - from) / MAX_FRAMES));
  for (const f of fs.readdirSync(dir)) if (f.startsWith("sheet_")) fs.rmSync(path.join(dir, f));
  await ffmpeg(["-i", low, "-vf", `fps=1/${step},scale=240:-2,drawtext=fontfile='${FONT}':text='%{eif\\:t+${Math.round(from)}\\:d}':x=6:y=6:fontsize=26:fontcolor=yellow:box=1:boxcolor=black@0.7,tile=5x4`, "-q:v", "4", path.join(dir, "sheet_%02d.jpg")], signal);
  const sheets = fs.readdirSync(dir).filter((f) => f.startsWith("sheet_")).sort().slice(0, Math.ceil(MAX_FRAMES / PER_SHEET));
  if (!sheets.length) return null;
  const system = `Ты монтажёр. Тебе показывают листы кадров видео: на каждом кадре жёлтым — его секунда в ролике, кадры идут через ${step} с слева направо и сверху вниз. Найди, с какой секунды начинается кусок длиной ${len.toFixed(1)} с, где обещанное видно всё это время: на кадре этой секунды и на следующих кадрах, которые покрывают ${len.toFixed(1)} с, — тот же план без смены сцены. Подходит чистый кадр: само событие, люди, экран, без титров-заставок, экранов загрузки и чёрных кадров. Если обещанное мелькает короче — выбери другой момент или ответь null. Если на кадрах есть плашки телеканала — бегущая строка, подписи внизу, полоса курсов или логотипы сверху, — укажи полосу кадра по высоте, где их нет: top и bottom — доли высоты кадра от верха (0 — верх, 1 — низ); кусок обрежут по ней. Без плашек — top 0 и bottom 1. Ответ — только JSON {"at": секунда, "top": 0.1, "bottom": 0.74} или {"at": null}, если обещанного в этих кадрах нет.`;
  const answer = await claudeJson<{ at: number | null; top?: number; bottom?: number }>(system, `Нужно увидеть: ${what}`, {
    task: "opus-moment",
    effort: "medium",
    images: sheets.map((f) => ({ base64: fs.readFileSync(path.join(dir, f)).toString("base64"), mediaType: "image/jpeg" })),
  }).catch(() => null);
  const at = Number(answer?.at);
  if (answer?.at === null || !Number.isFinite(at)) return null;
  const top = Math.min(0.5, Math.max(0, Number(answer?.top) || 0));
  const bottom = Math.max(top, Math.min(1, Number(answer?.bottom) || 1));
  // чистой картинки меньше 45% высоты — после обрезки останется мыло
  if (bottom - top < 0.45) return null;
  return { at: Math.max(0, Math.min(at, total - len)), top, bottom };
}
