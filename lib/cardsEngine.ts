import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Word } from "./transcribe";
import type { CardsShot } from "./cards/plan";
import { renderTurnTaken, takeRenderTurn } from "./astraEngine";

/**
 * Монтаж «С картинками» на движке Астры (Remotion): раскадровку делает сайт, движок готовит картинки
 * (фото медиатеки, сцены генератора, фото из Википедии), собирает монтаж из кубиков и рендерит.
 * CARDS_ENGINE=ffmpeg возвращает прежнюю неподвижную карточку.
 */
export const cardsEngineEnabled = () => String(process.env.CARDS_ENGINE ?? "remotion").toLowerCase() !== "ffmpeg";

const STAGES: Record<string, [string, number]> = {
  prepare: ["Картинки: подготовка записи", 40],
  assets: ["Картинки: фото и сцены", 46],
  final: ["Картинки: сборка ролика", 70],
};

export async function runCardsEngine(opts: {
  dir: string;
  /** Чистая запись (clean.mp4 или исходник без склеек). */
  source: string;
  words: Word[];
  duration: number;
  shots: CardsShot[];
  emphasis: number[];
  faceFrom?: { video: string; filter: string; duration: number };
  signal?: AbortSignal;
  setStep: (step: string, progress: number) => void;
}): Promise<void> {
  const root = process.cwd();
  const engine = path.join(root, "astra-engine");
  const workDir = path.join(opts.dir, "cards");
  // Новый монтаж — с чистого листа; нарисованные сцены прошлого запуска остаются в кэше (public/asset-cache).
  fs.rmSync(path.join(workDir, "run"), { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const specFile = path.join(workDir, "spec.json");
  fs.writeFileSync(specFile, JSON.stringify({
    video: path.resolve(opts.dir, opts.source),
    faceFrom: opts.faceFrom,
    duration: opts.duration,
    words: opts.words.map(w => ({ word: w.word, start: w.start, end: w.end })),
    shots: opts.shots,
    emphasis: opts.emphasis,
    workDir,
    renderGate: true,
    soundsDir: path.join(root, "assets", "astra", "sounds"),
    cacheDir: fs.existsSync(path.join(root, "astra-sounds")) ? path.join(root, "astra-sounds") : path.join(root, "data", "astra-cache"),
  }));

  let result = "";
  let error = "";
  let failure: unknown = null;
  let closed = false;
  let releaseRender: (() => void) | null = null;
  const tail: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(engine, "node_modules", "tsx", "dist", "cli.mjs"), "director/run-cards.ts", specFile], {
      cwd: engine, env: process.env, stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.on("error", () => { /* движок уже завершился */ });
    const stop = (reason: unknown) => { if (!failure) failure = reason; child.kill(); };
    if (opts.signal?.aborted) stop(new Error("Монтаж остановлен"));
    opts.signal?.addEventListener("abort", () => stop(new Error("Монтаж остановлен")), { once: true });
    const renderTurn = () => {
      if (renderTurnTaken()) opts.setStep("Картинки: ждём, собирается предыдущий ролик", 70);
      void takeRenderTurn().then(release => {
        if (closed) { release(); return; }
        releaseRender = release;
        // Единственное сообщение движку: после него канал закрывается, иначе процесс не завершится.
        child.stdin.end("GO render\n");
      });
    };
    let pending = "";
    const line = (text: string) => {
      const [kind, ...rest] = text.split(" ");
      const value = rest.join(" ");
      if (kind === "STAGE") {
        const [name, fraction] = value.split(" ");
        const stage = STAGES[name];
        if (stage) opts.setStep(fraction && name === "final" ? `${stage[0]}: ${Math.round(Number(fraction) * 100)}%` : stage[0],
          stage[1] + (name === "final" && fraction ? Math.round(Number(fraction) * 20) : 0));
      } else if (kind === "LOG") console.log(`  Картинки: ${value}`);
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
      else reject(new Error(`Монтаж картинок не собрался: ${error || tail.slice(-3).join(" | ") || `код ${code}`}`.slice(0, 900)));
    });
  });
  fs.copyFileSync(result, path.join(opts.dir, "out.mp4"));
}
