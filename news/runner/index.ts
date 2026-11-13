/**
 * Исполнитель «Новостей» на ПК: по одному забирает задания у сайта, делает ролик (news/runner/pipeline) и отдаёт
 * его обратно. Каждые 5 секунд — запрос задания (вместе со списком треков из news/music) и пульс текущего.
 * Запуск: news/runner/start-runner.ps1 (ключи из .env основной папки, адреса мостов на этом ПК).
 */
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createVideo, importReady } from "./pipeline/create";
import { coverFrame, rerender } from "./pipeline/montage";
import { listTracks, prepareBed } from "./pipeline/sounds";
import { useResults } from "./pipeline/insights";
import { createPrep, type Prep } from "./pipeline/prep";
import { createSequels } from "./pipeline/sequels";
import { createStock, type Stock } from "./pipeline/stock";
import { NEWS_ROOT, type Hooks } from "./pipeline/util";
import type { MusicTrack, NewsJob, NewsProject } from "./protocol";
import { createSite, isJobLost, type Site } from "./site";

const WORK = process.env.NEWS_WORK_DIR || path.join(NEWS_ROOT, ".work");
const HISTORY = path.join(WORK, "history.json");
const STOCK = path.join(WORK, "stock.json");
const POLL_MS = 5000;
/**
 * Сколько роликов исполнитель делает разом (владелец 1.11: «пусть делают параллельно все»): пока один ждёт Claude или
 * голос, другие качают, разбирают и монтируются. Монтаж — по одному (montage.ts), разбор и ElevenLabs — общими местами.
 */
const MAX_JOBS = Number(process.env.NEWS_MAX_JOBS || 5);
const HEARTBEAT_MS = 5000;
const MAX_ERROR_CHARS = 600;

export const logLine = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

/** Что владелец прочтёт под заданием: сообщение и причины, по-русски, не длиннее 600 знаков. */
function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    const message = (current instanceof Error ? current.message : String(current)).trim();
    if (message && !parts.some((p) => p.includes(message))) parts.push(message);
    current = current instanceof Error ? current.cause : undefined;
  }
  let text = parts.join(" — ") || "неизвестная ошибка";
  if (!/[а-яё]/i.test(text)) text = `Ролик не сделан: ${text}`;
  return text.slice(0, MAX_ERROR_CHARS);
}

async function runJob(site: Site, stock: Stock, prep: Prep, project: NewsProject, job: NewsJob) {
  const controller = new AbortController();
  let step = "Начинаем";
  let progress = 1;
  let lost = false;
  const beat = async () => {
    try {
      await site.progress({ id: project.id, jobId: job.id, step, progress });
    } catch (error) {
      if (isJobLost(error)) {
        lost = true;
        controller.abort(new Error("Задание отменили на сайте"));
      }
    }
  };
  const timer = setInterval(() => void beat(), HEARTBEAT_MS);
  const hooks: Hooks = {
    signal: controller.signal,
    log: (line) => logLine(`[${project.id}] ${line}`),
    step: async (text, p) => {
      step = text;
      progress = Math.max(progress, Math.min(99, p));
      logLine(`[${project.id}] ${text} (${progress}%)`);
      await beat();
    },
  };
  const workDir = path.join(WORK, project.id);
  try {
    await beat();
    // the site lays the track under the render itself: a rerender keeps the owner's choice
    const made = job.task === "rerender"
      ? { ...(await rerender(workDir, hooks)), music: null }
      : (await importReady(workDir, (story) => site.story({ id: project.id, jobId: job.id, story }), hooks)) ??
        (await createVideo(workDir, HISTORY, stock, (story) => site.story({ id: project.id, jobId: job.id, story }), hooks, job.pick, prep));
    await hooks.step("Загружаем ролик на сайт", 97);
    await site.uploadVideo(project.id, job.id, made.file, { signal: controller.signal });
    // чистый кадр для обложки (первый план без субтитров): без него сайт возьмёт кадр готового ролика
    await coverFrame(workDir)
      .then((frame) => (frame ? site.uploadFrame(project.id, job.id, frame, { signal: controller.signal }) : undefined))
      .catch((e) => logLine(`[${project.id}] кадр для обложки не ушёл: ${(e as Error).message}`));
    await site.complete({ id: project.id, jobId: job.id, video: { duration: made.duration, music: made.music } });
    logLine(`[${project.id}] готово: ${made.duration.toFixed(1)} с${made.music ? `, начинает с трека ${made.music}` : ""}`);
  } catch (error) {
    if (lost) {
      logLine(`[${project.id}] задание отменено на сайте`);
      return;
    }
    const text = errorText(error);
    logLine(`[${project.id}] ошибка: ${text}`);
    if (error instanceof Error && error.stack) console.error(error.stack);
    await site.complete({ id: project.id, jobId: job.id, error: text }).catch((e) => logLine(`не удалось сообщить об ошибке: ${(e as Error).message}`));
  } finally {
    clearInterval(timer);
  }
}

/** Куски треков, которых нет на сайте: готовятся (кэш по sig) и уходят по одному; сбой одного не держит остальные. */
async function sendTracks(site: Site, tracks: MusicTrack[], need: string[]) {
  for (const file of need) {
    const track = tracks.find((t) => t.file === file);
    if (!track?.sig) continue;
    try {
      await site.uploadTrack(track, await prepareBed(track));
      logLine(`трек на сайте: ${file}`);
    } catch (error) {
      logLine(`трек ${file} не ушёл на сайт: ${(error as Error).message}`);
    }
  }
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const site = createSite();
  useResults(() => site.results());
  const stock = createStock(STOCK, HISTORY, logLine);
  const sequels = createSequels(WORK, HISTORY, stock, logLine);
  const prep = createPrep(WORK, HISTORY, stock, logLine);
  logLine(`исполнитель Новостей: сайт ${site.url}, папка ${WORK}, историй в запасе ${stock.count()}`);
  const active = new Map<string, Promise<void>>();
  for (;;) {
    try {
      // все места заняты — только ждём; задания сами шлют пульс
      if (active.size >= MAX_JOBS) {
        await Promise.race([...active.values(), sleep(POLL_MS)]);
        continue;
      }
      const tracks = await listTracks();
      const { claimed, needTracks, orders } = await site.claim(tracks, stock.report());
      if (needTracks.length) await sendTracks(site, tracks, needTracks);
      // «Не то» и «Убрать» владельца — сразу; «Найти ещё» — когда ПК свободен (сайт повторяет просьбу, пока поиск не пошёл)
      for (const id of orders.reject) stock.reject(id);
      for (const id of orders.drop) stock.drop(id);
      if (claimed) {
        const id = claimed.project.id;
        logLine(`задание ${claimed.job.task} для ${id}${active.size ? ` (разом с ${active.size})` : ""}`);
        active.set(id, runJob(site, stock, prep, claimed.project, claimed.job).finally(() => active.delete(id)));
        // следующее задание очереди — сразу, не дожидаясь этого
        continue;
      }
      if (active.size) {
        await sleep(POLL_MS);
        continue;
      }
      // свободен: истории ищутся про запас, чтобы «Создать» не ждало поиска, а лучшие из них заготавливаются до сценария,
      // чтобы «Монтировать» не ждало ни роликов, ни разбора, ни Claude (prep.ts)
      stock.refill(orders.more);
      sequels.maybeCheck();
      prep.maybe();
    } catch (error) {
      logLine(`сайт: ${(error as Error).message}`);
    }
    await sleep(POLL_MS);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) void main();
