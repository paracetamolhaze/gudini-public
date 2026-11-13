/**
 * Исполнитель «Опус 5.5» на ПК: воркер сайта (Docker) отдаёт сюда чистую запись автора и её слова, здесь ролик
 * монтируется движком «Новостей» (make.ts) и забирается обратно. Ролики — по одному, остальные ждут в очереди.
 *
 *   POST /jobs                {topic, script, words}  → {id}
 *   PUT  /jobs/:id/source     тело — mp4 записи
 *   POST /jobs/:id/start
 *   GET  /jobs/:id            → {state, step, progress, error?}
 *   GET  /jobs/:id/out        → готовый mp4
 *   DELETE /jobs/:id          — отмена
 * Доступ — Bearer CLAUDE_BRIDGE_TOKEN (тот же секрет у воркера). Порт OPUS_PORT, по умолчанию 43147, на всех адресах:
 * воркер приходит из Docker через host.docker.internal.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { makeOpus, type OpusInput } from "./make";

const PORT = Number(process.env.OPUS_PORT || 43147);
const WORK = process.env.OPUS_WORK_DIR || path.join(process.env.USERPROFILE || ".", "gudini-opus-data");
/** Готовые и упавшие задания живут сутки: воркер забирает ролик за минуту, остальное — для разбора. */
const KEEP_MS = 24 * 3600_000;

type Job = { id: string; state: "uploading" | "queued" | "running" | "done" | "error"; step: string; progress: number; error?: string; out?: string; input: OpusInput; at: number; abort: AbortController };
const jobs = new Map<string, Job>();
const queue: string[] = [];
let busy = false;

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function next() {
  if (busy) return;
  const id = queue.shift();
  if (!id) return;
  const job = jobs.get(id);
  if (!job || job.state !== "queued") return void next();
  busy = true;
  job.state = "running";
  const dir = path.join(WORK, id);
  try {
    const made = await makeOpus(dir, path.join(dir, "source.mp4"), job.input, {
      signal: job.abort.signal,
      log: (line) => log(`[${id}] ${line}`),
      step: async (text, p) => {
        job.step = text;
        job.progress = Math.max(job.progress, Math.min(99, Math.round(p)));
        log(`[${id}] ${text} (${job.progress}%)`);
      },
    });
    job.out = made.file;
    job.state = "done";
    job.step = "Готово";
    job.progress = 100;
    log(`[${id}] готово: ${made.duration.toFixed(1)} с`);
  } catch (error) {
    job.state = "error";
    job.error = (error instanceof Error ? error.message : String(error)).slice(0, 600);
    log(`[${id}] ошибка: ${job.error}`);
    if (error instanceof Error && error.stack) console.error(error.stack);
  } finally {
    busy = false;
    void next();
  }
}

function sweep() {
  for (const [id, job] of jobs) {
    if (job.state !== "running" && Date.now() - job.at > KEEP_MS) {
      jobs.delete(id);
      fs.rmSync(path.join(WORK, id), { recursive: true, force: true });
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const token = process.env.CLAUDE_BRIDGE_TOKEN;
    if (!token || req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: "нет доступа" });
    const url = new URL(req.url ?? "/", "http://x");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "jobs") return send(res, 404, { error: "нет такого адреса" });
    if (req.method === "POST" && parts.length === 1) {
      const body = (await readJson(req)) as Partial<OpusInput>;
      if (!Array.isArray(body.words) || !body.words.length) return send(res, 400, { error: "нет слов записи" });
      const id = randomUUID().slice(0, 8);
      fs.mkdirSync(path.join(WORK, id), { recursive: true });
      jobs.set(id, { id, state: "uploading", step: "Ждём запись", progress: 0, input: { topic: String(body.topic ?? ""), script: String(body.script ?? ""), words: body.words }, at: Date.now(), abort: new AbortController() });
      sweep();
      return send(res, 200, { id });
    }
    const job = jobs.get(parts[1] ?? "");
    if (!job) return send(res, 404, { error: "задание не найдено — исполнитель «Опус 5.5» перезапускался, монтаж нужно повторить" });
    const dir = path.join(WORK, job.id);
    if (req.method === "PUT" && parts[2] === "source") {
      await pipeline(req, fs.createWriteStream(path.join(dir, "source.mp4")));
      return send(res, 200, { ok: true, bytes: fs.statSync(path.join(dir, "source.mp4")).size });
    }
    if (req.method === "POST" && parts[2] === "start") {
      if (!fs.existsSync(path.join(dir, "source.mp4"))) return send(res, 400, { error: "запись не загружена" });
      if (job.state === "uploading") {
        job.state = "queued";
        job.step = busy ? "Ждём, пока смонтируется другой ролик" : "В очереди";
        queue.push(job.id);
        void next();
      }
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && parts.length === 2) return send(res, 200, { state: job.state, step: job.step, progress: job.progress, ...(job.error ? { error: job.error } : {}) });
    if (req.method === "GET" && parts[2] === "out") {
      if (job.state !== "done" || !job.out) return send(res, 409, { error: "ролик ещё не готов" });
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": fs.statSync(job.out).size });
      return void fs.createReadStream(job.out).pipe(res);
    }
    if (req.method === "DELETE" && parts.length === 2) {
      job.abort.abort(new Error("Монтаж отменён"));
      if (job.state !== "running") job.state = "error";
      job.error = "Монтаж отменён";
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "нет такого адреса" });
  } catch (error) {
    send(res, 500, { error: (error as Error).message });
  }
});

fs.mkdirSync(WORK, { recursive: true });
server.listen(PORT, "0.0.0.0", () => log(`исполнитель «Опус 5.5»: порт ${PORT}, папка ${WORK}`));
