/**
 * The runner's side of the site protocol (/api/news/runner/*), Basic auth worker:<SITE_PASSWORD> like the 3D runner.
 * Network errors and 5xx are retried: the site restarts on deploys and must not cost a finished render.
 * A 4xx is final — retrying a refused request only repeats the refusal.
 */
import type { ChannelResult } from "./pipeline/insights";
import fs from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { ClaimResponse, CompleteBody, MusicTrack, NewsJob, NewsProject, ProgressBody, StockOrders, StockReport, StoryBody } from "./protocol";

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

/** 409: the site gave the job away (cancelled, or another runner took it). */
export const isJobLost = (error: unknown): boolean => error instanceof SiteError && error.status === 409;

const RUNNER = "/api/news/runner";
const CHUNK_BYTES = 4 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120_000;
const MAX_RESUMES = 20;
/** About five and a half minutes in all: inside the ten minutes after which the site calls a silent job lost. */
const PATIENT_DELAYS_MS = [1000, 3000, 8000, 15000, ...Array<number>(10).fill(30000)];
const RETRY_DELAYS_MS = [1000, 3000, 8000];

const parse = (text: string): unknown => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
const field = (data: unknown, key: string): unknown => (data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined);
const isOffset = (value: unknown, size: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= size;
const describe = (error: unknown) => (error instanceof Error ? error.message + (error.cause instanceof Error ? ` (${error.cause.message})` : "") : String(error));

type CallOptions = { signal?: AbortSignal; timeoutMs?: number; patient?: boolean };

export function createSite(url = process.env.GUDINI_URL || "http://127.0.0.1:3000", password = process.env.SITE_PASSWORD || "") {
  const base = url.replace(/\/+$/, "");
  const auth = "Basic " + Buffer.from(`worker:${password}`).toString("base64");

  async function call(method: string, pathname: string, init: { body?: string | Uint8Array<ArrayBuffer>; headers?: Record<string, string> }, opts: CallOptions = {}): Promise<unknown> {
    const delays = opts.patient ? PATIENT_DELAYS_MS : RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
      opts.signal?.throwIfAborted();
      const signals = [AbortSignal.timeout(opts.timeoutMs ?? 30_000), ...(opts.signal ? [opts.signal] : [])];
      let status: number;
      let text: string;
      try {
        const res = await fetch(base + pathname, { method, headers: { Authorization: auth, ...init.headers }, body: init.body, signal: AbortSignal.any(signals) });
        status = res.status;
        text = await res.text();
      } catch (error) {
        if (opts.signal?.aborted) throw opts.signal.reason;
        if (attempt >= delays.length) throw new Error(`${method} ${pathname}: сайт не отвечает — ${describe(error)}`, { cause: error });
        await sleep(delays[attempt], undefined, { signal: opts.signal });
        continue;
      }
      if (status >= 200 && status < 300) return parse(text);
      if (status >= 500 && attempt < delays.length) {
        await sleep(delays[attempt], undefined, { signal: opts.signal });
        continue;
      }
      const data = parse(text);
      const reason = field(data, "error") ?? data ?? "";
      throw new SiteError(status, `${method} ${pathname}: ${status} ${String(typeof reason === "string" ? reason : JSON.stringify(reason)).slice(0, 200)}`, data);
    }
  }
  const post = (pathname: string, body: unknown, opts?: CallOptions) =>
    call("POST", RUNNER + pathname, { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }, opts);

  return {
    url: base,

    /**
     * The oldest queued job, already marked running for this runner, or null. Every claim also reports the music
     * folder and the story stock; needTracks — the tracks whose prepared piece the site still lacks, orders — what the
     * owner asked of the stock on the list page.
     */
    async claim(tracks: MusicTrack[], stock: StockReport, opts?: CallOptions): Promise<{ claimed: { project: NewsProject; job: NewsJob } | null; needTracks: string[]; orders: StockOrders }> {
      const data = (await post("/claim", { tracks, stock }, opts)) as ClaimResponse | null;
      if (!data || typeof data !== "object" || !("job" in data)) throw new Error("Сайт ответил на запрос задания не по протоколу");
      const needTracks = Array.isArray(data.needTracks) ? data.needTracks.filter((f): f is string => typeof f === "string") : [];
      const raw = data.stockOrders;
      const ids = (v: unknown) => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : []);
      const orders: StockOrders = { reject: ids(raw?.reject), drop: ids(raw?.drop), more: raw?.more === true };
      if (data.job === null) return { claimed: null, needTracks, orders };
      if (!("project" in data) || typeof data.project?.id !== "string" || typeof data.job?.id !== "string") throw new Error("Сайт выдал задание без проекта");
      return { claimed: { project: data.project, job: data.job }, needTracks, orders };
    },

    /** The prepared piece of a track, whole in one PUT (a couple of megabytes). */
    async uploadTrack(track: MusicTrack, file: string, opts?: CallOptions) {
      const body = new Uint8Array(await fs.readFile(file));
      const pathname = `${RUNNER}/track?file=${encodeURIComponent(track.file)}&sig=${encodeURIComponent(track.sig ?? "")}`;
      await call("PUT", pathname, { body, headers: { "Content-Type": "audio/mp4" } }, { ...opts, timeoutMs: UPLOAD_TIMEOUT_MS });
    },

    /** How the published news videos did (views, watch time), most viewed first. */
    async results(opts?: CallOptions): Promise<ChannelResult[]> {
      const list = field(await call("GET", RUNNER + "/results", {}, opts), "results");
      return Array.isArray(list) ? (list as ChannelResult[]) : [];
    },

    async progress(body: ProgressBody, opts?: CallOptions) {
      await post("/progress", body, opts);
    },

    async story(body: StoryBody, opts?: CallOptions) {
      await post("/story", body, { ...opts, patient: true });
    },

    async complete(body: CompleteBody, opts?: CallOptions) {
      await post("/complete", body, { ...opts, patient: true });
    },

    /** The clean frame for the cover (runner/frame): a JPEG of a few hundred kilobytes in one PUT. */
    async uploadFrame(id: string, jobId: string, file: string, opts: { signal?: AbortSignal } = {}) {
      const body = new Uint8Array(await fs.readFile(file));
      await call("PUT", `${RUNNER}/frame/${encodeURIComponent(id)}?jobId=${encodeURIComponent(jobId)}`, { body, headers: { "Content-Type": "image/jpeg" } }, { signal: opts.signal, patient: true });
    },

    /** Chunked PUT with x-offset/x-file-size; on 409 { received } it continues from what the site has. */
    async uploadVideo(id: string, jobId: string, file: string, opts: { signal?: AbortSignal } = {}) {
      const pathname = `${RUNNER}/video/${encodeURIComponent(id)}?jobId=${encodeURIComponent(jobId)}`;
      const handle = await fs.open(file, "r");
      try {
        const { size } = await handle.stat();
        if (size === 0) throw new Error("Ролик пустой: загружать нечего");
        let offset = 0;
        let resumes = 0;
        while (offset < size) {
          const length = Math.min(CHUNK_BYTES, size - offset);
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
