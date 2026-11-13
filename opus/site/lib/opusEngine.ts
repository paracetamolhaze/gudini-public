import fs from "node:fs";
import path from "node:path";

/**
 * Монтаж «Опус 5.5»: ролик собирает исполнитель на ПК (news/runner/opus в ветке opus) движком «Новостей» — настоящие
 * кадры, страницы под маркером, числа и субтитры поверх записи автора. Воркер отдаёт ему чистую запись и её слова,
 * ждёт и забирает готовый out.mp4 в папку проекта. Адрес — OPUS_URL (по умолчанию порт 43147 на этом ПК), доступ —
 * тот же CLAUDE_BRIDGE_TOKEN, что у мостов Claude.
 */
const BASE = () => (process.env.OPUS_URL || "http://host.docker.internal:43147").replace(/\/+$/, "");
const POLL_MS = 3000;
/** Поиск кадров, скачивание и рендер минутного ролика — 10–20 минут; дольше часа ждать незачем. */
const LIMIT_MS = 60 * 60_000;

type Word = { word: string; start: number; end: number };

async function call(method: string, pathname: string, body?: BodyInit, type?: string): Promise<Response> {
  const token = process.env.CLAUDE_BRIDGE_TOKEN;
  if (!token) throw new Error("Опус 5.5: у воркера нет CLAUDE_BRIDGE_TOKEN");
  let res: Response;
  try {
    res = await fetch(BASE() + pathname, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(type ? { "Content-Type": type } : {}) },
      body,
      // запись едет потоком: без duplex fetch в Node не отправляет поток
      ...(body && typeof body !== "string" ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (error) {
    throw new Error(`Опус 5.5: исполнитель на ПК недоступен (${(error as Error).message}) — он запускается вместе с «Гудини»`);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(`Опус 5.5: ${j?.error ?? `ответ ${res.status}`}`);
  }
  return res;
}

export async function runOpusEngine(opts: {
  dir: string;
  source: string;
  words: Word[];
  topic: string;
  script: string;
  signal?: AbortSignal;
  setStep: (step: string, progress: number) => void;
}): Promise<void> {
  const source = path.isAbsolute(opts.source) ? opts.source : path.join(opts.dir, opts.source);
  opts.setStep("Опус 5.5: отправляем запись на монтаж", 38);
  const words = opts.words.map((w) => ({ w: w.word, s: w.start, e: w.end }));
  const { id } = (await (await call("POST", "/jobs", JSON.stringify({ topic: opts.topic, script: opts.script, words }), "application/json")).json()) as { id: string };
  const size = fs.statSync(source).size;
  await call("PUT", `/jobs/${id}/source`, fs.createReadStream(source) as unknown as BodyInit, "video/mp4").catch((e) => {
    throw new Error(`${(e as Error).message} (запись ${Math.round(size / 1e6)} МБ не ушла)`);
  });
  await call("POST", `/jobs/${id}/start`);
  const cancel = () => void call("DELETE", `/jobs/${id}`).catch(() => {});
  opts.signal?.addEventListener("abort", cancel, { once: true });
  const started = Date.now();
  let silent = 0;
  try {
    for (;;) {
      opts.signal?.throwIfAborted();
      if (Date.now() - started > LIMIT_MS) {
        cancel();
        throw new Error("Опус 5.5: монтаж идёт дольше часа — остановлен");
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
      // пока ПК рендерит, связь через Docker иногда рвётся на один запрос (проба 5.11: «fetch failed» на 70%) — монтаж
      // на ПК идёт дальше; сдаёмся, только если исполнитель молчит две минуты подряд
      let st: { state: string; step: string; progress: number; error?: string };
      try {
        st = (await (await call("GET", `/jobs/${id}`)).json()) as typeof st;
        silent = 0;
      } catch (error) {
        if (/не найдено/.test((error as Error).message) || ++silent * POLL_MS > 120_000) throw error;
        continue;
      }
      if (st.state === "error") throw new Error(`Опус 5.5: ${st.error ?? "монтаж не удался"}`);
      // ход на ПК (0–100) ложится в 38–90 общего хода
      opts.setStep(`Опус 5.5: ${st.step}`, 38 + Math.round((st.progress / 100) * 52));
      if (st.state === "done") break;
    }
    opts.setStep("Опус 5.5: забираем ролик", 90);
    const res = await call("GET", `/jobs/${id}/out`).catch(async () => {
      await new Promise((r) => setTimeout(r, 5000));
      return call("GET", `/jobs/${id}/out`);
    });
    const tmp = path.join(opts.dir, "out.opus.tmp.mp4");
    const out = fs.createWriteStream(tmp);
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(value)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
    fs.renameSync(tmp, path.join(opts.dir, "out.mp4"));
  } finally {
    opts.signal?.removeEventListener("abort", cancel);
  }
}
