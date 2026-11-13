// Claude через свой мост «Новостей» на этом ПК (news/bridge, 127.0.0.1:43141): ищет истории в интернете,
// смотрит листы кадров и пишет раскладку. До 25 минут на задание — поиск с проверкой фактов в пять минут не влезает.
import http from "node:http";
import { parseJson } from "./util";

export type Image = { base64: string; mediaType: string };
/** effort — сколько Claude думает: высокое для текста и поиска историй, среднее и низкое для разбора кадров и проверок. */
type Effort = "low" | "medium" | "high";
type Job = { system: string; user: string; images?: Image[]; tools?: "web"; label: string; effort?: Effort };

const BASE = () => process.env.NEWS_CLAUDE_URL || "http://127.0.0.1:43141";
const URL_ = () => new URL("/complete", BASE());
const RUN_MS = 27 * 60_000;

function post(job: Job): Promise<{ status: number; data: { text?: string; error?: string } }> {
  const body = JSON.stringify(job);
  const token = process.env.CLAUDE_BRIDGE_TOKEN;
  if (!token) return Promise.reject(new Error("Нет CLAUDE_BRIDGE_TOKEN для моста Новостей"));
  return new Promise((resolve, reject) => {
    // своё соединение на каждое задание: общий keep-alive брал сокет, который мост уже закрыл, — «read ECONNRESET»
    // ронял ролик на раскладке (31.10, стажёры и Круз)
    const req = http.request(URL_(), { method: "POST", agent: false, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${token}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        clearTimeout(timer);
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch {
          reject(new Error("Мост Новостей ответил не JSON"));
        }
      });
    });
    // native http: у fetch пятиминутный предел ожидания заголовков, а мост отвечает, когда Claude закончит
    const timer = setTimeout(() => req.destroy(new Error("Мост Новостей не ответил за 27 минут")), RUN_MS);
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Мост Новостей недоступен: ${error.message}`));
    });
    req.end(body);
  });
}

type Activity = { label: string; startedAt: string; searches: number; pages: number; last: string };

/** Что мост делает сейчас: поиски и страницы идущих ответов (GET /health). */
async function activity(): Promise<Activity[]> {
  const res = await fetch(new URL("/health", BASE()), { headers: { Authorization: `Bearer ${process.env.CLAUDE_BRIDGE_TOKEN ?? ""}` }, signal: AbortSignal.timeout(5000) });
  const data = (await res.json()) as { activity?: Activity[] };
  return Array.isArray(data.activity) ? data.activity : [];
}

/** Строка шага на странице ролика, пока Claude ищет истории: сколько идёт поиск, сколько запросов и последний. */
export async function searchStatus(started: number): Promise<string> {
  // поиск идёт по нескольким направлениям разом (story.ts LANES): запросы и страницы — всех вместе
  const all = (await activity().catch(() => [])).filter((x) => x.label === "news-story");
  const min = Math.max(1, Math.round((Date.now() - started) / 60_000));
  const done = all.length ? ` · запросов ${all.reduce((n, a) => n + a.searches, 0)}, страниц ${all.reduce((n, a) => n + a.pages, 0)}` : "";
  const last = all.map((a) => a.last).filter(Boolean).at(-1);
  const now = last ? ` · сейчас: «${last}»` : "";
  return `Ищем громкие истории: ${min} мин из примерно 15${done}${now}`.slice(0, 160);
}

/** Ответ Claude как JSON; web — сам ищет и открывает страницы, images — смотрит картинки. Один повтор на сбой. */
export async function claudeJson<T>(system: string, user: string, opts: { web?: boolean; task?: string; images?: Image[]; effort?: Effort } = {}): Promise<T> {
  const job: Job = { system, user, label: opts.task ?? "news", ...(opts.web ? { tools: "web" as const } : {}), ...(opts.images?.length ? { images: opts.images } : {}), ...(opts.effort ? { effort: opts.effort } : {}) };
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    // сбой сети (мост перезапускался, сокет оборвался) — ещё одна попытка через 5 с
    const answer = await post(job).catch(async (error: Error) => {
      if (attempt) throw error;
      last = error.message;
      await new Promise((r) => setTimeout(r, 5000));
      return null;
    });
    if (!answer) continue;
    const { status, data } = answer;
    if (status >= 200 && status < 300 && typeof data.text === "string") return parseJson<T>(data.text);
    last = data.error || `код ${status}`;
    if (status === 400 || status === 401) break;
  }
  throw new Error(`Мост Новостей: ${last}`);
}
