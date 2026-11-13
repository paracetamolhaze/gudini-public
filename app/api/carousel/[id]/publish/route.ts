import { splitThreadsCaption } from "@/lib/carousel/text";
import { schedulesOf, schedulePlatform } from "@/lib/carousel/scheduleState";
import fs from "fs";
import { threadsAccountInfo } from "@/lib/carousel/threads";
import { NextRequest } from "next/server";
import { fail, guard, ok, readBody } from "@/lib/carousel/http";
import { attachJob, CarouselError, isJobPending, slideFilePath, updateCarousel } from "@/lib/carousel/store";
import { findInstagramAccount, instagramAccountInfo, toPublishAccount } from "@/lib/carousel/account";
import { needsVerification } from "@/lib/carousel/instagram";
import { instagramImageProblems } from "@/lib/carousel/jpeg";
import { composeCaption, composeThreadsCaption } from "@/lib/carousel/text";
import { publishReadiness, toClient } from "@/lib/carousel/view";
import { ensureRunner } from "@/lib/carousel/runnerControl";
import { archivePublishedPost, publishedToAccount } from "@/lib/carousel/publicationHistory";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Публикация в Instagram — только явным действием пользователя после предпросмотра.
 * Аккаунт закрепляется в момент нажатия. Проверка «можно ли» и постановка задания идут
 * под одной блокировкой карусели: двойное нажатие и повторный запрос получают отказ,
 * а не вторую публикацию.
 *
 * action=verify — только проверка исхода уже отправленной публикации, без новой отправки.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await readBody(req);
    const now = new Date().toISOString();

    if (body.action === "verify") {
      const c = updateCarousel(id, (x) => {
        if (isJobPending(x.job)) throw new CarouselError("Идёт задание — дождитесь его окончания", 409, "busy");
        if (!needsVerification(x.publish)) throw new CarouselError("Проверять нечего: публикация не отправлялась или её итог уже известен", 409, "nothing_to_verify");
        attachJob(x, "verify_publish");
        x.publish.log = [...x.publish.log, { at: now, text: "Проверка статуса поставлена в очередь" }].slice(-60);
      });
      ensureRunner();
      return ok(toClient(c), 202);
    }

    if (body.platform !== undefined && !["instagram", "threads"].includes(body.platform)) return ok({error:"Неизвестная площадка"},400);
    const threads = body.platform === "threads" ? await threadsAccountInfo() : null;
    const chosen = findInstagramAccount(typeof body.accountId === "string" ? body.accountId : null);
    const info = threads ?? instagramAccountInfo(chosen?.id ?? null);
    if (!(threads ? threads.account && threads.account.id === body.accountId : chosen) || info.problems.length) return ok({ error: info.problems.join(" ") || "Аккаунт Instagram не выбран", code: "instagram_unavailable" }, 400);
    const account = (threads?.account ?? toPublishAccount(chosen!));

    const c = updateCarousel(id, (x) => {
      const p = x.publish;
      if (isJobPending(x.job)) throw new CarouselError("Идёт задание — дождитесь его окончания", 409, "busy");
      if (publishedToAccount(x, account.igUserId, account.via === "threads" ? "threads" : "instagram")) {
        throw new CarouselError("Карусель уже опубликована в этом аккаунте. Выберите другой аккаунт.", 409, "already_published");
      }
      if (needsVerification(p)) throw new CarouselError("Исход прошлой публикации не подтверждён — сначала нажмите «Проверить статус»", 409, "verify_first");
      if (p.status === "queued" || p.status === "running") throw new CarouselError("Публикация уже выполняется", 409, "publishing");
      const sc = x.schedule?.status;
      if (sc === "queued" || sc === "publishing" || sc === "uncertain") throw new CarouselError("Публикация по расписанию уже выполняется", 409, "publishing");
      if (typeof body.revision !== "number" || body.revision !== x.revision) {
        throw new CarouselError("Карусель изменилась после просмотра — обновите страницу и проверьте слайды перед публикацией", 409, "stale_revision");
      }
      const problems = publishReadiness(x, account.via === "threads" ? "threads" : "instagram");
      if (problems.length) throw new CarouselError(`Карусель не готова к публикации: ${problems.join("; ")}`, 400, "not_ready");
      x.slides.forEach((s, i) => {
        const file = slideFilePath(x.id, s.render!.file!);
        if (!fs.existsSync(file)) throw new CarouselError(`Файл слайда ${i + 1} не найден — запустите сборку заново`, 409, "file_missing");
        const bad = instagramImageProblems(fs.readFileSync(file));
        if (bad.length) throw new CarouselError(`Слайд ${i + 1} не подходит Instagram: ${bad.join(", ")}`, 400, "bad_image");
      });

      const fullCaption = account.via === "threads" ? composeThreadsCaption(typeof body.caption === "string" ? body.caption : x.caption) : composeCaption(x.caption, x.hashtags);
      const parts = account.via === "threads" ? splitThreadsCaption(fullCaption) : [fullCaption];
      const caption = parts[0];
      // тот же набор слайдов, подпись и аккаунт — созданные раньше контейнеры переиспользуются
      const same =
        p.status !== "published" && p.account?.via === account.via &&
        p.revision === x.revision &&
        p.caption === caption &&
        p.account?.igUserId === account.igUserId &&
        p.items.length === x.slides.length &&
        p.items.every((it, i) => it.slideId === x.slides[i].id && it.file === x.slides[i].render!.file);
      archivePublishedPost(x);
      x.publish = {
        ...p,
        mediaId: undefined,
        permalink: undefined,
        publishedAt: undefined,
        publishSentAt: undefined,
        status: "queued",
        stage: undefined,
        revision: x.revision,
        caption,
        replies: account.via === "threads" ? parts.slice(1).map(text => ({text})) : undefined,
        account,
        scheduleId: undefined,
        igUserId: account.igUserId,
        accountLabel: account.label ?? undefined,
        items: x.slides.map((s, i) => (same ? p.items[i] : { slideId: s.id, file: s.render!.file! })),
        containerId: same ? p.containerId : undefined,
        containerCreatedAt: same ? p.containerCreatedAt : undefined,
        publishAttempts: 0,
        error: undefined,
        note: undefined,
        retryable: undefined,
        log: [...p.log, { at: now, text: `${p.status === "failed" ? "Повтор публикации" : "Публикация"} поставлена в очередь, аккаунт ${account.label ?? account.igUserId}` }].slice(-60),
      };
      for (const sc of schedulesOf(x)) if (schedulePlatform(sc) === (account.via === "threads" ? "threads" : "instagram") && (sc.status === "scheduled" || sc.status === "missed")) {
        sc.status = "canceled";
        sc.history = [...sc.history, { at: now, text: "Снято с расписания: публикация запущена вручную" }].slice(-40);
      }
      attachJob(x, "publish");
    });
    ensureRunner();
    return ok(toClient(c), 202);
  } catch (e) {
    return fail(e);
  }
}
