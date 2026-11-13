// Общее для шагов конвейера: внешние программы, ответы моделей, ход работы.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Корень папки news/ с кодом (engine, runner). */
export const NEWS_ROOT = path.resolve(import.meta.dirname, "../..");
/** Где лежат звуки, музыка и образец голоса: папка news в основной папке gudini, её пополняет владелец. */
export const MEDIA_ROOT = process.env.NEWS_MEDIA_DIR || NEWS_ROOT;

/** Ход задания: шаг по-русски для страницы и доля готовности 0..100. */
export type Hooks = { step: (text: string, progress: number) => Promise<void>; log: (line: string) => void; signal?: AbortSignal };

/**
 * Внешняя программа с пределом по времени. На Windows таймаут execFile убивает только сам процесс: его дети (ffmpeg,
 * которого запускает транскрипция) держат трубы открытыми, и ожидание висело часами (5.11: Бразилия простояла 6,5 ч
 * на расшифровке). Поэтому по таймауту снимается всё дерево процессов (taskkill /T), а ответ приходит в любом случае.
 */
export function run(cmd: string, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal; cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  const limit = opts.timeoutMs ?? 600_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const child = execFile(cmd, args, { maxBuffer: 64 << 20, cwd: opts.cwd, windowsHide: true }, (error, stdout, stderr) =>
      done(() => (error ? reject(Object.assign(error, { stdout: String(stdout), stderr: String(stderr) })) : resolve({ stdout: String(stdout), stderr: String(stderr) }))),
    );
    const killTree = () => {
      if (!child.pid) return;
      if (process.platform === "win32") execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
      else child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      killTree();
      done(() => reject(new Error(`${path.basename(cmd)} не ответил за ${Math.round(limit / 60_000)} мин и остановлен`)));
    }, limit);
    const onAbort = () => {
      killTree();
      done(() => reject(new Error("Задание отменено")));
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export const ffmpeg = (args: string[], signal?: AbortSignal) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { signal });

export async function duration(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(stdout.trim()) || 0;
}

/** Есть ли в файле видео: фото-посты TikTok скачиваются одним звуком. */
export async function hasVideo(file: string): Promise<boolean> {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", file]);
    return Number(stdout.trim()) > 0;
  } catch {
    return false;
  }
}

/**
 * Есть ли в файле звук: ролик без звуковой дорожки (трейлер без звука, нарезка с X) расшифровать нельзя — whisper падает
 * на нём «tuple index out of range», и задание падало целиком (10.11: Мейвезер, c5 и c6).
 */
export async function hasAudio(file: string): Promise<boolean> {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Интегральная громкость файла, LUFS; у файла без звука — тишина (−70), а не ошибка. */
export async function loudness(file: string, from?: number, to?: number): Promise<number> {
  const window = from !== undefined ? ["-ss", String(from), ...(to !== undefined ? ["-to", String(to)] : [])] : [];
  if (!(await hasAudio(file))) return -70;
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", ...window, "-i", file, "-vn", "-af", "ebur128=framelog=quiet", "-f", "null", "-"]);
  const m = [...stderr.matchAll(/^\s+I:\s+(-?[\d.]+) LUFS/gm)].pop();
  return m ? Number(m[1]) : -70;
}

/** Питон с faster-whisper и librosa на этом ПК; скрипты лежат в runner/py. */
export async function python(script: string, args: string[], signal?: AbortSignal, timeoutMs = 1_800_000): Promise<string> {
  const { stdout } = await run(process.env.NEWS_PYTHON || "python", ["-I", path.join(NEWS_ROOT, "runner/py", script), ...args], { timeoutMs, signal });
  return stdout;
}

/** JSON из ответа модели: целиком или первый блок ```json … ``` / первая {…}. */
export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [text, fenced?.[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      /* следующий вариант */
    }
  }
  throw new Error(`Модель ответила не JSON: ${text.slice(0, 200)}`);
}

/**
 * fn для каждого элемента, не больше limit одновременно; результаты — в порядке элементов. Ролик делается быстрее,
 * когда независимые шаги идут разом (владелец 29.10: «ускоряй, 6 минут норм»).
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const writeJson = (file: string, data: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
};
export const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;

/** Слова текста так, как их размечает выравнивание ElevenLabs: по пробелам, знаки при словах. */
export const splitWords = (text: string) => text.split(/\s+/).filter(Boolean);
