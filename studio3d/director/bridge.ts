import http from "node:http";
import https from "node:https";

export type BridgeImage = { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };
/** tools "web": Claude searches and opens pages itself (WebSearch, WebFetch) before it answers. */
export type AskOptions = { images?: BridgeImage[]; label: string; effort?: "low" | "medium" | "high" | "xhigh" | "max"; tools?: "web"; timeoutMs?: number; signal?: AbortSignal };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One request to the 3D bridge: Claude Code of the owner's PC on his subscription (studio3d/bridge). */
const post = (url: URL, body: string, token: string, timeoutMs: number, signal?: AbortSignal) =>
  new Promise<{ status: number; text: string }>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    // a fresh socket per call: long requests on reused keep-alive sockets were dropped as "socket hang up"
    const req = lib.request(
      url,
      { method: "POST", agent: false, timeout: timeoutMs, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${token}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    // the bridge sends nothing until it is done, so this idle timeout is the whole answer's time
    req.on("timeout", () => req.destroy(Object.assign(new Error("Claude не уложился во время ответа"), { final: true })));
    req.on("error", reject);
    signal?.addEventListener("abort", () => req.destroy(new Error("Задача остановлена")), { once: true });
    req.end(body);
  });

/**
 * Asks Claude through the bridge and returns its text. Busy or briefly unreachable bridges are retried;
 * a spent subscription limit is reported in words the owner understands.
 */
export const askClaude = async (system: string, user: string, opts: AskOptions): Promise<string> => {
  const base = process.env.STUDIO3D_CLAUDE_URL || "http://127.0.0.1:43135";
  const token = process.env.CLAUDE_BRIDGE_TOKEN;
  if (!token) throw new Error("Нет CLAUDE_BRIDGE_TOKEN для моста Claude");
  const body = JSON.stringify({
    system,
    user,
    images: opts.images?.length ? opts.images : undefined,
    model: process.env.STUDIO3D_CLAUDE_MODEL || "claude-opus-5-5",
    effort: opts.effort ?? "high",
    label: opts.label,
    ...(opts.tools ? { tools: opts.tools } : {}),
  });
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (opts.signal?.aborted) throw new Error("Задача остановлена");
    try {
      // a minute over the bridge's own limit, so the bridge's answer (504) arrives before the client gives up
      const res = await post(new URL("/complete", base), body, token, opts.timeoutMs ?? Number(process.env.STUDIO3D_CLAUDE_TIMEOUT_MS || 25 * 60_000) + 60_000, opts.signal);
      if (res.status === 200) {
        const json = JSON.parse(res.text) as { text?: string };
        if (!json.text?.trim()) throw new Error("Claude вернул пустой ответ");
        return json.text;
      }
      const message = (() => {
        try {
          return (JSON.parse(res.text) as { error?: string }).error ?? res.text;
        } catch {
          return res.text;
        }
      })();
      if (res.status === 429) throw Object.assign(new Error(`Лимит подписки Claude исчерпан: ${message}`.slice(0, 300)), { final: true });
      if (res.status === 401) throw Object.assign(new Error("Мост Claude не принял токен"), { final: true });
      if (res.status === 400 || res.status === 413) throw Object.assign(new Error(`Мост Claude отклонил запрос: ${message}`.slice(0, 300)), { final: true });
      // a run that hit the time limit would hit it again: one more try only doubles the subscription spent
      if (res.status === 504) throw Object.assign(new Error(`Claude не уложился во время ответа: ${message}`.slice(0, 300)), { final: true });
      last = `Мост Claude ${res.status}: ${message}`.slice(0, 300);
    } catch (error) {
      if ((error as { final?: boolean }).final || opts.signal?.aborted) throw error;
      last = (error as Error).message;
      if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/.test(last)) last = `Мост Claude для 3Д не запущен (${base})`;
    }
    await sleep(5000 * (attempt + 1));
  }
  throw new Error(last || "Мост Claude не ответил");
};

/** The first fenced block of the given language, or the whole text when there is none. */
export const fenced = (text: string, lang: string) => {
  const m = text.match(new RegExp("```" + lang + "\\s*\\n([\\s\\S]*?)```"));
  if (m) return m[1].trim();
  const any = text.match(/```[a-z]*\s*\n([\s\S]*?)```/);
  return (any ? any[1] : text).trim();
};

/** The top-level balanced {...} of a text (nested objects stay inside theirs), skipping braces inside JSON strings. */
const objectsIn = (text: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inString) {
        if (c === "\\") j++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        out.push(text.slice(i, j + 1));
        i = j;
        break;
      }
    }
  }
  return out;
};

/**
 * Parses the JSON object of an answer: the ```json block when there is one, otherwise the last balanced object
 * that parses — prose around it may quote code with braces of its own.
 */
export const jsonOf = <T>(text: string): T => {
  const fence = text.match(/```json\s*\n([\s\S]*?)```/);
  if (fence) return JSON.parse(fence[1].trim()) as T;
  const candidates = objectsIn(text).reverse();
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // a code fragment, not the answer
    }
  }
  throw new Error("В ответе Claude нет JSON");
};
