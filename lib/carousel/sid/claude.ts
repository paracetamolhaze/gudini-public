import http from "node:http";
import https from "node:https";

/**
 * Свой мост каруселей к Claude (carousel/bridge/claude-bridge.mjs на Windows, порт 43143): Claude Code
 * по подписке владельца с WebSearch и WebFetch. Отдельный от «Новостей» и «3Д», чтобы разделы не ждали
 * друг друга; у моста одно место, поэтому задания каруселей идут по одному. Native http, как у других
 * мостов: у fetch пятиминутный предел ожидания заголовков, а поиск темы идёт дольше.
 */

export type SidClaudeJob = {
  label: string;
  system: string;
  user: string;
  tools?: "web" | "none";
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  images?: { base64: string; mediaType: string }[];
  timeoutMs?: number;
};

const bridgeUrl = () => process.env.CAROUSEL_CLAUDE_URL || "";
const bridgeToken = () => process.env.CAROUSEL_CLAUDE_TOKEN || process.env.CLAUDE_BRIDGE_TOKEN || "";

/** Что мешает созданию карусели — готовые фразы для интерфейса, без значений секретов. */
export function sidConfigProblems(): string[] {
  const p: string[] = [];
  if (!bridgeUrl()) p.push("Не задан CAROUSEL_CLAUDE_URL — адрес моста каруселей к Claude.");
  if (bridgeToken().length < 32) p.push("Не задан токен моста Claude (CLAUDE_BRIDGE_TOKEN).");
  if (!(process.env.CODEX_IMAGE_BRIDGE_URL || process.env.CODEX_BRIDGE_URL) || !process.env.CODEX_BRIDGE_TOKEN) p.push("Не настроен мост картинок Codex (CODEX_IMAGE_BRIDGE_URL, CODEX_BRIDGE_TOKEN) — обложку нечем нарисовать.");
  return p;
}

export async function sidClaude(job: SidClaudeJob): Promise<string> {
  if (!bridgeUrl() || !bridgeToken()) throw new Error("Мост каруселей к Claude не настроен: CAROUSEL_CLAUDE_URL и CLAUDE_BRIDGE_TOKEN");
  const url = new URL("/complete", bridgeUrl());
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Некорректный CAROUSEL_CLAUDE_URL");
  const body = JSON.stringify({ system: job.system, user: job.user, images: job.images ?? [], tools: job.tools ?? "none", effort: job.effort ?? "high", label: job.label });
  const timeoutMs = job.timeoutMs ?? 26 * 60_000;
  const { status, data } = await new Promise<{ status: number; data: any }>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${bridgeToken()}` } }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 16_000_000) req.destroy(new Error("oversized"));
        else chunks.push(c);
      });
      res.on("error", () => reject(new Error("Связь с мостом Claude оборвалась")));
      res.on("end", () => {
        clearTimeout(timer);
        try {
          resolve({ status: res.statusCode || 502, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch {
          reject(new Error("Мост Claude вернул некорректный ответ"));
        }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error("timeout")), timeoutMs);
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(e.message === "timeout" ? "Claude не ответил вовремя — повторите задание" : "Мост каруселей к Claude недоступен: проверьте, что он запущен на ПК (carousel/bridge), и повторите"));
    });
    req.end(body);
  });
  if (status < 200 || status >= 300) throw new Error(typeof data?.error === "string" ? `Claude: ${data.error}` : `Мост Claude ответил ${status}`);
  if (typeof data?.text !== "string" || !data.text.trim()) throw new Error("Claude вернул пустой ответ");
  return data.text;
}
