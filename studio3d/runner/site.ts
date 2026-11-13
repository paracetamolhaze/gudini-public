/**
 * The container's side of the site protocol (/api/3d/runner/*), with the same Basic auth as the worker.
 * Network errors and 5xx are retried: the site restarts on deploys and must not cost a finished render.
 * A 4xx is final — retrying a refused request only repeats the refusal.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import {
  MAX_CLIP_BYTES,
  MAX_DUB_BYTES,
  type ClaimResponse,
  type CompleteBody,
  type IdeaBody,
  type IdeaPool,
  type IdeaStored,
  type Job3D,
  type Project3D,
  type ProgressBody,
  type ScriptBody,
  type VoicePlan,
} from "./protocol";

export type SiteOptions = {
  url?: string;
  password?: string;
  /** Pauses before each retry; one attempt more than there are pauses. */
  retryDelaysMs?: number[];
  /** Pauses for calls that must survive a site restart: the finished video and its completion. */
  patientDelaysMs?: number[];
  timeoutMs?: number;
  /** The hosting proxy cuts long request bodies, so the video goes up in pieces. */
  chunkBytes?: number;
};

/** `patient`: keep retrying for minutes — a deploy restarts the site, and a finished render must not be lost to it. */
export type CallOptions = { signal?: AbortSignal; timeoutMs?: number; retry?: boolean; patient?: boolean };

/** voice: the site's voice plan, sent with "voice" and "montage" jobs; an older site sends none. */
export type Claimed = { project: Project3D; job: Job3D; voice?: VoicePlan };

/** The site answered with an error status. 409 means the job is no longer this container's. */
export class SiteError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "SiteError";
    this.status = status;
    this.body = body;
  }
}

export const isJobLost = (error: unknown): boolean => error instanceof SiteError && error.status === 409;

const RUNNER = "/api/3d/runner";
const CHUNK_BYTES = 4 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120_000;
/** A resume answer that keeps sending the upload back is a bug on one side; it must not loop forever. */
const MAX_RESUMES = 20;
/** About five and a half minutes in all: inside the ten minutes after which the site calls a silent job lost. */
const PATIENT_DELAYS_MS = [1000, 3000, 8000, 15000, ...Array<number>(10).fill(30000)];

const describe = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
  return error.message + cause;
};

const parse = (text: string): unknown => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const field = (data: unknown, key: string): unknown =>
  data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;

const isOffset = (value: unknown, size: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= size;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const enc = encodeURIComponent;

type Body = string | Uint8Array<ArrayBuffer>;

export function createSite(options: SiteOptions = {}) {
  const base = (options.url || process.env.GUDINI_URL || "http://gudini-site:3000").replace(/\/+$/, "");
  const password = options.password ?? (process.env.GUDINI_PASSWORD || process.env.SITE_PASSWORD || "");
  const auth = "Basic " + Buffer.from(`worker:${password}`).toString("base64");
  const retryDelays = options.retryDelaysMs ?? [1000, 3000, 8000];
  const patientDelays = options.patientDelaysMs ?? options.retryDelaysMs ?? PATIENT_DELAYS_MS;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const chunkBytes = options.chunkBytes ?? CHUNK_BYTES;

  /** One request with the retries; a 2xx answer comes back as bytes, any other status as a SiteError. */
  async function exchange(method: string, pathname: string, init: { body?: Body; headers?: Record<string, string> }, opts: CallOptions = {}): Promise<{ bytes: Buffer; headers: Headers }> {
    const delays = opts.retry === false ? [] : opts.patient ? patientDelays : retryDelays;
    for (let attempt = 0; ; attempt++) {
      opts.signal?.throwIfAborted();
      const signals = [AbortSignal.timeout(opts.timeoutMs ?? timeoutMs)];
      if (opts.signal) signals.push(opts.signal);
      let status: number;
      let headers: Headers;
      let bytes: Buffer;
      try {
        const res = await fetch(base + pathname, { method, headers: { Authorization: auth, ...init.headers }, body: init.body, signal: AbortSignal.any(signals) });
        status = res.status;
        headers = res.headers;
        // The body is read inside the try: a connection cut mid-answer is a network error like any other.
        bytes = Buffer.from(await res.arrayBuffer());
      } catch (error) {
        if (opts.signal?.aborted) throw opts.signal.reason;
        if (attempt >= delays.length) throw new Error(`${method} ${pathname}: сайт не отвечает — ${describe(error)}`, { cause: error });
        await sleep(delays[attempt], undefined, { signal: opts.signal });
        continue;
      }
      if (status >= 200 && status < 300) return { bytes, headers };
      if (status >= 500 && attempt < delays.length) {
        await sleep(delays[attempt], undefined, { signal: opts.signal });
        continue;
      }
      const data = parse(bytes.toString("utf8"));
      const reason = field(data, "error") ?? data ?? "";
      throw new SiteError(status, `${method} ${pathname}: ${status} ${String(typeof reason === "string" ? reason : JSON.stringify(reason)).slice(0, 200)}`, data);
    }
  }

  const call = async (method: string, pathname: string, init: { body?: Body; headers?: Record<string, string> }, opts: CallOptions = {}): Promise<unknown> =>
    parse((await exchange(method, pathname, init, opts)).bytes.toString("utf8"));

  const post = (pathname: string, body: unknown, opts?: CallOptions) =>
    call("POST", RUNNER + pathname, { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }, opts);

  return {
    url: base,

    /** The oldest queued job, already marked running for this container, or null. */
    async claim(opts?: CallOptions): Promise<Claimed | null> {
      const data = (await post("/claim", {}, opts)) as ClaimResponse | null;
      if (!data || typeof data !== "object" || !("job" in data)) throw new Error("Сайт ответил на запрос задания не по протоколу");
      if (data.job === null) return null;
      if (typeof data.project?.id !== "string" || typeof data.job?.id !== "string") throw new Error("Сайт выдал задание без проекта");
      // the plan is checked by the job itself: a bad one must fail that job on the site, not leave it running here
      const voice = data.voice && typeof data.voice === "object" ? data.voice : undefined;
      return voice ? { project: data.project, job: data.job, voice } : { project: data.project, job: data.job };
    },

    /** Also the heartbeat. A 409 (SiteError) means the site gave the job away. */
    async progress(body: ProgressBody, opts?: CallOptions): Promise<void> {
      await post("/progress", body, opts);
    },

    async sendScript(body: ScriptBody, opts?: CallOptions): Promise<void> {
      await post("/script", body, opts);
    },

    async ideas(body: { id: string; jobId: string }, opts?: CallOptions): Promise<IdeaPool> {
      const data = (await post("/ideas", body, opts)) as Partial<IdeaPool> | null;
      if (!data || !Array.isArray(data.cards) || !Array.isArray(data.recent)) throw new Error("Сайт ответил на запрос идей не по протоколу");
      return { cards: data.cards, recent: data.recent };
    },

    async sendIdea(body: IdeaBody, opts?: CallOptions): Promise<IdeaStored> {
      const data = (await post("/idea", body, opts)) as Partial<IdeaStored> | null;
      if (typeof data?.topic !== "string" || !data.topic) throw new Error("Сайт не подтвердил идею ролика");
      return { topic: data.topic, notes: typeof data.notes === "string" ? data.notes : null };
    },

    /**
     * The site answers with the job as it stored it: for a montage or a dub, finishedAt is the new video's time on the
     * site (Video3D.at, the same moment). Null from a site that does not say.
     */
    async complete(body: CompleteBody, opts?: CallOptions): Promise<Job3D | null> {
      const data = await post("/complete", body, opts);
      const job = data && typeof data === "object" ? (data as { job?: unknown }).job : undefined;
      return job && typeof job === "object" ? (job as Job3D) : null;
    },

    /**
     * One recorded take of an owner line, saved to dest only when its bytes are the planned ones.
     * A body that does not match the site's own x-sha256 was cut on the way and is fetched again;
     * an x-sha256 other than the plan's means the line was re-recorded after the montage started.
     */
    /** The size of the project's current video file on the site (one byte asked with Range), or null if it does not tell. */
    async videoBytes(id: string, opts: { signal?: AbortSignal } = {}): Promise<number | null> {
      const { headers } = await exchange("GET", `/api/3d/${enc(id)}/video`, { headers: { Range: "bytes=0-0" } }, { signal: opts.signal });
      const total = Number(headers.get("content-range")?.split("/")[1]);
      return Number.isFinite(total) && total > 0 ? total : null;
    },

    async downloadDub(id: string, jobId: string, key: string, take: number, dest: string, expect: { sha256: string; bytes?: number }, opts: { signal?: AbortSignal } = {}): Promise<void> {
      const pathname = `${RUNNER}/dub/${enc(id)}/${enc(key)}?jobId=${enc(jobId)}&take=${enc(String(take))}`;
      const want = expect.sha256.trim().toLowerCase();
      for (let attempt = 0; ; attempt++) {
        const { bytes, headers } = await exchange("GET", pathname, {}, { signal: opts.signal, timeoutMs: UPLOAD_TIMEOUT_MS });
        const told = headers.get("x-sha256")?.trim().toLowerCase();
        if (told && told !== want) throw new Error(`Запись реплики на сайте уже другая, чем при запуске монтажа (дубль ${take}) — запустите монтаж снова`);
        if (bytes.length > MAX_DUB_BYTES) throw new Error(`Запись реплики больше ${MAX_DUB_BYTES / 1024 / 1024} МБ — сайт прислал не то`);
        if (sha256(bytes) === want && (expect.bytes === undefined || bytes.length === expect.bytes)) {
          const part = `${dest}.part`;
          await fs.writeFile(part, bytes);
          await fs.rename(part, dest);
          return;
        }
        if (attempt >= retryDelays.length) throw new Error(`Запись реплики (дубль ${take}) пришла повреждённой: контрольная сумма не сходится`);
        await sleep(retryDelays[attempt], undefined, { signal: opts.signal });
      }
    },

    /** One synthesized line of a "voice" job, the whole mp3 in one request (they are a few hundred KB). */
    async uploadClip(id: string, jobId: string, key: string, file: string, duration: number, opts: { signal?: AbortSignal } = {}): Promise<void> {
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Реплика без длительности: загружать нечего");
      const bytes = await fs.readFile(file);
      if (!bytes.length) throw new Error("Реплика пустая: загружать нечего");
      if (bytes.length > MAX_CLIP_BYTES) throw new Error(`Реплика больше ${MAX_CLIP_BYTES / 1024 / 1024} МБ: сайт её не примет`);
      const pathname = `${RUNNER}/clip/${enc(id)}/${enc(key)}?jobId=${enc(jobId)}&duration=${duration.toFixed(3)}`;
      // patient like the video: a voiced line is the job's result, a site restarting for a deploy must not cost it
      await call("PUT", pathname, { body: new Uint8Array(bytes), headers: { "Content-Type": "audio/mpeg" } }, { signal: opts.signal, timeoutMs: UPLOAD_TIMEOUT_MS, patient: true });
    },

    /** Chunked PUT with x-offset/x-file-size; on 409 { received } it continues from what the site has. */
    async uploadVideo(id: string, jobId: string, file: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
      const pathname = `${RUNNER}/video/${enc(id)}?jobId=${enc(jobId)}`;
      const handle = await fs.open(file, "r");
      try {
        const { size } = await handle.stat();
        if (size === 0) throw new Error("Ролик пустой: загружать нечего");
        let offset = 0;
        let resumes = 0;
        while (offset < size) {
          const length = Math.min(chunkBytes, size - offset);
          const chunk = new Uint8Array(length);
          const { bytesRead } = await handle.read(chunk, 0, length, offset);
          if (bytesRead !== length) throw new Error("Ролик изменился во время загрузки");
          const headers = { "Content-Type": "application/octet-stream", "x-offset": String(offset), "x-file-size": String(size) };
          let next: number;
          try {
            const data = await call("PUT", pathname, { body: chunk, headers }, { signal: opts.signal, timeoutMs: UPLOAD_TIMEOUT_MS, patient: true });
            const received = field(data, "received");
            next = field(data, "done") === true ? size : isOffset(received, size) ? received : offset + length;
          } catch (error) {
            const received = error instanceof SiteError && error.status === 409 ? field(error.body, "received") : undefined;
            // 409 without { received } is the other 409: the job is no longer ours, and that ends the upload.
            if (!isOffset(received, size)) throw error;
            resumes++;
            next = received;
          }
          if (next <= offset) resumes++;
          if (resumes > MAX_RESUMES) throw new Error("Сайт не принимает ролик: загрузка ходит по кругу");
          offset = next;
        }
      } finally {
        await handle.close();
      }
    },
  };
}

export type Site = ReturnType<typeof createSite>;
