import http from "node:http";

export type BridgeImage = { base64: string; mediaType: string };
export type BridgeResult = { text: string; runId: string; durationMs: number; queueWaitMs?: number; usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number } };

/** Who thinks for Astra: the Codex service (GPT, the default) or Claude through her own bridge (ASTRA_BRAIN=claude). */
export const astraBrain = (): "codex" | "claude" => (String(process.env.ASTRA_BRAIN ?? "").toLowerCase() === "claude" ? "claude" : "codex");

/**
 * Astra through Claude: her bridge on Windows runs Claude Code on the owner's subscription and takes pictures too
 * (astra-engine/bridge/claude-bridge.mjs).
 */
async function askClaude(payload: { system: string; user: string; images?: BridgeImage[]; tools?: "web"; label?: string }, timeoutMs: number): Promise<BridgeResult> {
  const token = process.env.CLAUDE_BRIDGE_TOKEN;
  if (!token) throw new Error("Не задан CLAUDE_BRIDGE_TOKEN для моста Астры к Claude");
  const started = Date.now();
  const data = await postBridge<{ text?: string; usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } }>("/complete",
    { ...payload, model: process.env.ASTRA_CLAUDE_MODEL || "claude-opus-5-5" }, timeoutMs,
    process.env.ASTRA_CLAUDE_URL ?? "http://host.docker.internal:43133", token, "Мост Claude");
  if (typeof data?.text !== "string" || !data.text.trim()) throw new Error("Мост Claude вернул пустой ответ");
  return { text: data.text, runId: "", durationMs: Date.now() - started,
    usage: { inputTokens: data.usage?.inputTokens ?? 0, outputTokens: data.usage?.outputTokens ?? 0, cacheReadTokens: data.usage?.cacheReadTokens ?? 0 } };
}

/** A question that needs the open web (a brand's pages): Codex with live search, or Claude with web search and page reading. */
export async function askWeb(system: string, user: string, timeoutMs = 5 * 60_000): Promise<string> {
  if (astraBrain() === "claude") return (await askClaude({ system, user, tools: "web", label: "поиск в интернете" }, timeoutMs)).text;
  // The Codex service takes only the model and effort the host is configured with.
  const answer = await postBridge<{ text: string }>("/complete", {
    stage: "Media Research", model: process.env.CODEX_MODEL || "gpt-6-astra", effort: process.env.CODEX_REASONING_EFFORT || "high", webSearch: "live", system, user,
  }, timeoutMs);
  return answer.text;
}

/**
 * Calls Astra: GPT via the local Codex service on Windows (it checks that the model and effort match its own settings,
 * so they come from the same variables), or Claude when ASTRA_BRAIN=claude.
 */
export async function askAstra(system: string, user: string, images: BridgeImage[] = [], timeoutMs = 25 * 60_000): Promise<BridgeResult> {
  if (astraBrain() === "claude") return askClaude({ system, user, images, label: system.slice(0, 60) }, timeoutMs);
  const token = process.env.CODEX_BRIDGE_TOKEN;
  if (!token) throw new Error("Не задан CODEX_BRIDGE_TOKEN для локального сервиса Codex");
  const url = new URL("/complete", process.env.CODEX_BRIDGE_URL ?? "http://127.0.0.1:43127");
  const body = JSON.stringify({
    stage: "Creative Director",
    model: process.env.CODEX_MODEL || "gpt-6-astra",
    effort: process.env.CODEX_REASONING_EFFORT || "high",
    system, user,
    ...(images.length ? { images } : {}),
  });
  const { status, data } = await new Promise<{ status: number; data: any }>((resolve, reject) => {
    // A fresh connection per call: Node keeps sockets alive, the service closes idle ones after 5 s, and a call that
    // reused such a socket died with "socket hang up" after a typecheck pause (2026-10-09).
    const req = http.request(url, { method: "POST", agent: false, headers: {
      "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${token}`,
    } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        clearTimeout(timer);
        try { resolve({ status: res.statusCode ?? 502, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch { reject(new Error("Сервис Codex вернул некорректный ответ")); }
      });
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new Error("Сервис Codex не ответил вовремя")), timeoutMs);
    req.on("error", reject);
    req.end(body);
  });
  if (status < 200 || status >= 300) throw new Error(`Сервис Codex: ${typeof data?.error === "string" ? data.error : status}`);
  if (typeof data?.text !== "string" || !data.text.trim()) throw new Error("Сервис Codex вернул пустой ответ");
  return data as BridgeResult;
}

/** The answer is the whole file; tolerate a stray code fence around it. */
export function extractCode(text: string): string {
  const fenced = text.match(/```(?:tsx|typescript|ts)?\s*\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim() + "\n";
}

/** POST to a local service on Windows: Codex by default (`/image` draws a picture with the owner's subscription), or Astra's Claude bridge. */
export async function postBridge<T>(pathname: string, payload: unknown, timeoutMs: number, base = process.env.CODEX_BRIDGE_URL ?? "http://127.0.0.1:43127",
  token = process.env.CODEX_BRIDGE_TOKEN, service = "Сервис Codex"): Promise<T> {
  if (!token) throw new Error(`Не задан токен для службы «${service}»`);
  const url = new URL(pathname, base);
  const body = JSON.stringify(payload);
  const { status, data } = await new Promise<{ status: number; data: any }>((resolve, reject) => {
    const req = http.request(url, { method: "POST", agent: false, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${token}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        clearTimeout(timer);
        try { resolve({ status: res.statusCode ?? 502, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch { reject(new Error(`${service} вернул некорректный ответ`)); }
      });
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new Error(`${service} не ответил вовремя`)), timeoutMs);
    req.on("error", reject);
    req.end(body);
  });
  if (status < 200 || status >= 300) throw new Error(`${service}: ${typeof data?.error === "string" ? data.error : status}`);
  return data as T;
}
