import { publishThreadsReplies } from "./threadsReplies";
import { threadsAccountInfo, threadsGraphFetch } from "./threads";
import { getSettings } from "../store";
import type { PublishAccount, PublishState } from "./types";
import { IG_API_VERSION } from "./limits";
import { CarouselError, getCarousel, mediaQuery, notFound, updateCarousel } from "./store";
import { accountAccessToken, findInstagramAccount, instagramAccountInfo, toPublishAccount } from "./account";
import { needsVerification, publishCarousel, verifyPublication, type PublishCtx } from "./instagram";
import { syncScheduleWithPublish } from "./schedule";
import { deckAltText, isDeck } from "./deck";
import { TELEGRAM_CHANNEL } from "./channel";

/**
 * Связка публикации с сайтом: закреплённый аккаунт Instagram (тот, что выбран при постановке —
 * сейчас или в расписании), продление его токена в его собственной записи, подписанные
 * ссылки на слайды и сохранение каждого шага в карусель. Реальная сеть — только здесь;
 * логика шагов — в instagram.ts.
 */

function logText(s: PublishState, text: string) {
  s.log = [...s.log, { at: new Date().toISOString(), text }].slice(-60);
}

/** Остановка без обращения к Instagram: состояние не остаётся «в процессе». */
export function settlePublish(id: string, message: string): PublishState {
  return updateCarousel(id, (c) => {
    const x = c.publish;
    if (needsVerification(x)) {
      x.status = "uncertain";
      x.retryable = false;
      x.error = `${message} Исход отправленной публикации не проверен — повторная отправка заблокирована до проверки статуса.`;
    } else if (x.status !== "published") {
      x.status = "failed";
      x.stage = undefined;
      x.retryable = true;
      x.error = message;
    }
    logText(x, message);
    syncScheduleWithPublish(c);
  }).publish;
}

export async function runPublishJob(id: string, mode: "publish" | "verify", onStep?: (text: string) => void): Promise<PublishState> {
  const c = getCarousel(id);
  if (!c) throw notFound();
  // аккаунт закреплён при постановке; у публикаций, поставленных до появления закрепления, — активный
  let account: PublishAccount | undefined = c.publish.account;
  if (!account) {
    const active = findInstagramAccount(null);
    if (active) account = toPublishAccount(active);
  }
  const isThreads = account?.via === "threads";
  const threads = isThreads ? await threadsAccountInfo() : null;
  const info = isThreads ? { problems: threads!.account?.igUserId === account?.igUserId ? threads!.problems : ["Аккаунт Threads изменился или отключён"], publicBaseUrl: getSettings().publicBaseUrl } : instagramAccountInfo(account?.id ?? null);
  if (!account || info.problems.length) return settlePublish(id, info.problems.join(" ") || "Аккаунт Instagram не выбран.");

  let token: string;
  try {
    token = isThreads ? "bridge" : await accountAccessToken(account);
  } catch (e: any) {
    return settlePublish(id, `Не удалось получить токен Instagram: ${String(e?.message ?? e).slice(0, 200)}`);
  }

  const base = (info.publicBaseUrl ?? getSettings().publicBaseUrl ?? "").replace(/\/$/, "");
  const pinned = account;
  const ctx: PublishCtx = {
    load: () => {
      const cur = getCarousel(id);
      if (!cur) throw notFound();
      return cur.publish;
    },
    save: (mutate) => {
      const s = updateCarousel(id, (cur) => {
        mutate(cur.publish);
        if (isThreads) {
          if (cur.publish.error) cur.publish.error = cur.publish.error.replaceAll("Instagram", "Threads");
          if (cur.publish.note) cur.publish.note = cur.publish.note.replaceAll("Instagram", "Threads");
          cur.publish.log = cur.publish.log.map(l => ({...l,text:l.text.replaceAll("Instagram", "Threads")}));
        }
        if (isThreads && cur.publish.status === "published" && cur.publish.replies?.some(r => !r.mediaId)) {
          cur.publish.status = cur.publish.mediaId ? "running" : "uncertain";
          if (!cur.publish.mediaId) cur.publish.error = "Threads подтвердил карусель, но не вернул её ID. Нажмите «Проверить статус» для продолжения.";
          cur.publish.stage = "verifying";
        }
        syncScheduleWithPublish(cur);
      }).publish;
      const last = s.log[s.log.length - 1];
      if (last && onStep) onStep(last.text);
      return s;
    },
    account: {
      token,
      igUserId: pinned.igUserId,
      graph: isThreads ? "https://carousel-bridge.invalid/v1" : `${pinned.via === "ig" ? "https://graph.instagram.com" : "https://graph.facebook.com"}/${IG_API_VERSION}`,
    },
    mediaUrl: (file) => `${base}/api/carousel/public/${id}/${file}?${mediaQuery(id, file)}`,
    // у карточек по скиллу на картинке только текст — он же и есть alt text; мост Threads его не ждёт
    altText: isDeck(c) && !isThreads ? (slideId) => {
      const slide = getCarousel(id)?.slides.find((s) => s.id === slideId);
      return slide ? deckAltText(slide, TELEGRAM_CHANNEL) : undefined;
    } : undefined,
    deps: {
      fetch: isThreads ? threadsGraphFetch(pinned) : (input, init) => fetch(input, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      timeoutMs: 60_000,
    },
  };

  updateCarousel(id, (cur) => {
    cur.publish.account = pinned;
    cur.publish.accountLabel = pinned.label ?? undefined;
  });
  try {
    if (!(isThreads && ctx.load().mediaId && ctx.load().replies?.length)) {
      await (mode === "verify" ? verifyPublication(ctx) : publishCarousel(ctx));
    }
    if (isThreads && ctx.load().mediaId && ctx.load().replies?.length) return publishThreadsReplies(ctx);
    return ctx.load();
  } catch (e: any) {
    if (e instanceof CarouselError && e.status === 404) throw e;
    return settlePublish(id, `Сбой публикации: ${String(e?.message ?? e).slice(0, 300)}`);
  }
}
