import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AstraState } from "./astra/types";
import type { Word } from "./transcribe";

/**
 * Новая Астра: монтаж пишет сама Астра (GPT-6 через мост Codex) из кубиков astra-engine (Remotion),
 * картинки готовит и проверяет она же. Включается ASTRA_ENGINE=remotion; без переменной работает прежняя Астра.
 */
export const astraEngineEnabled = () => String(process.env.ASTRA_ENGINE ?? "").toLowerCase() === "remotion";

// Этапы движка на шкале конвейера: до монтажа 26 %, после рендера идут проверка и обложка (92 %+).
const STAGES: Record<string, [string, number]> = {
  prepare: ["Астра: подготовка записи", 27],
  write: ["Астра пишет монтаж", 30],
  assets: ["Астра готовит картинки", 40],
  check: ["Астра проверяет картинки", 50],
  cutout: ["Астра: вырезка автора", 55],
  draft: ["Астра смотрит черновик", 60],
  review: ["Астра правит монтаж", 65],
  final: ["Астра собирает ролик", 70],
};

/**
 * Финальный рендер — по одному на воркер: второй одновременный рендер только делит процессор,
 * и первый ролик вышел бы позже. Соседний ролик в это время пишется и рисуется.
 */
let renderHeld = false;
const renderWaiters: (() => void)[] = [];
/** Монтаж «С картинками» рендерит на том же движке и стоит в той же очереди. */
export const renderTurnTaken = () => renderHeld;
export function takeRenderTurn(): Promise<() => void> {
  const release = () => {
    const next = renderWaiters.shift();
    if (next) next(); else renderHeld = false;
  };
  if (!renderHeld) { renderHeld = true; return Promise.resolve(release); }
  return new Promise(resolve => renderWaiters.push(() => resolve(release)));
}

/** Обещание, которое выполняют снаружи: запись ещё режется, а Астра уже пишет монтаж. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export async function runAstraEngine(opts: {
  dir: string;
  /** Чистая запись; пока она режется — обещание её имени. */
  source: string | Promise<string>;
  words: Word[];
  duration: number;
  topic: string;
  facts?: string[];
  /** Исходник, фильтр кадра 1080×1920 и длительность: голову автора Астра находит по нему, не дожидаясь нарезки. */
  faceFrom?: { video: string; filter: string; duration: number };
  /** Отмена: конвейер упал — Астра останавливается, а не монтирует в пустоту. */
  signal?: AbortSignal;
  setStep: (step: string, progress: number) => void;
}): Promise<void> {
  const root = process.cwd();
  const engine = path.join(root, "astra-engine");
  const workDir = path.join(opts.dir, "astra");
  // Новый монтаж — с чистого листа; найденные и сгенерированные картинки прошлого запуска остаются в кэше.
  fs.rmSync(path.join(workDir, "run"), { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  // Метка готовой записи: движок ждёт её перед всем, что читает видео.
  const readyFile = path.join(workDir, "video.ready");
  fs.rmSync(readyFile, { force: true });
  const early = typeof opts.source !== "string";
  const specFile = path.join(workDir, "spec.json");
  fs.writeFileSync(specFile, JSON.stringify({
    video: typeof opts.source === "string" ? path.resolve(opts.dir, opts.source) : undefined,
    videoReady: early ? readyFile : undefined,
    faceFrom: opts.faceFrom,
    duration: opts.duration,
    words: opts.words.map(w => ({ word: w.word, start: w.start, end: w.end })),
    topic: opts.topic,
    facts: opts.facts,
    workDir,
    // Перед финальным рендером движок ждёт очереди (WAIT render → GO render).
    renderGate: true,
    soundsDir: path.join(root, "assets", "astra", "sounds"),
    memesDir: path.join(root, "assets", "astra", "memes"),
    // Звуки подготовлены при сборке образа (astra-sounds); без него готовятся один раз в data.
    cacheDir: fs.existsSync(path.join(root, "astra-sounds")) ? path.join(root, "astra-sounds") : path.join(root, "data", "astra-cache"),
  }));

  let result = "";
  let error = "";
  let failure: unknown = null;
  let closed = false;
  let releaseRender: (() => void) | null = null;
  const tail: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(engine, "node_modules", "tsx", "dist", "cli.mjs"), "director/run-job.ts", specFile], {
      cwd: engine, env: process.env, stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.on("error", () => { /* движок уже завершился */ });
    const stop = (reason: unknown) => { if (!failure) failure = reason; child.kill(); };
    const renderTurn = () => {
      if (renderHeld) opts.setStep("Астра ждёт: собирается предыдущий ролик", 70);
      void takeRenderTurn().then(release => {
        if (closed) { release(); return; }
        releaseRender = release;
        // Единственное сообщение движку: после него канал закрывается, иначе процесс движка не завершится.
        child.stdin.end("GO render\n");
      });
    };
    if (opts.signal?.aborted) stop(new Error("Монтаж остановлен"));
    opts.signal?.addEventListener("abort", () => stop(new Error("Монтаж остановлен")), { once: true });
    if (early) Promise.resolve(opts.source).then(source => {
      // Сначала во временный файл: движок не прочтёт недописанный путь.
      fs.writeFileSync(`${readyFile}.part`, path.resolve(opts.dir, source));
      fs.renameSync(`${readyFile}.part`, readyFile);
    }, stop);
    let pending = "";
    const line = (text: string) => {
      const [kind, ...rest] = text.split(" ");
      const value = rest.join(" ");
      if (kind === "STAGE") {
        const [name, fraction] = value.split(" ");
        const stage = STAGES[name];
        if (stage) opts.setStep(fraction && name === "final" ? `${stage[0]}: ${Math.round(Number(fraction) * 100)}%` : stage[0],
          stage[1] + (name === "final" && fraction ? Math.round(Number(fraction) * 20) : 0));
      } else if (kind === "LOG") console.log(`  Астра: ${value}`);
      else if (kind === "WAIT" && value === "render") renderTurn();
      else if (kind === "RESULT") result = value;
      else if (kind === "ERROR") error = value;
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      let n: number;
      while ((n = pending.indexOf("\n")) >= 0) { line(pending.slice(0, n).trim()); pending = pending.slice(n + 1); }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      tail.push(...chunk.split(/\r?\n/).filter(Boolean));
      tail.splice(0, Math.max(0, tail.length - 30));
    });
    child.on("error", reject);
    child.on("close", code => {
      closed = true;
      if (pending.trim()) line(pending.trim());
      (releaseRender as (() => void) | null)?.();
      if (failure) reject(failure);
      else if (code === 0 && result && fs.existsSync(result)) resolve();
      else reject(new Error(`Астра не собрала ролик: ${error || tail.slice(-3).join(" | ") || `код ${code}`}`.slice(0, 900)));
    });
  });
  fs.copyFileSync(result, path.join(opts.dir, "out.mp4"));
}

/** Состояние, которое понимает страница проекта: монтаж готов, материалов не требуется. */
export function astraEngineState(duration: number): AstraState {
  return { version: 1, key: `remotion-${Date.now()}`, status: "rendered", duration, inserts: [] };
}
