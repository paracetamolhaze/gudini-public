import { getCarousel } from "@/lib/carousel/store";
import { runSchedulerTick } from "@/lib/carousel/runnerControl";
import { utcToZonedLocal } from "@/lib/carousel/timezone";
import { threadsAccountInfo } from "@/lib/carousel/threads";
import { NextRequest } from "next/server";
import { fail, guard, ok, readBody } from "@/lib/carousel/http";
import { findInstagramAccount, instagramAccountInfo, toPublishAccount } from "@/lib/carousel/account";
import { cancelSchedule, refreshScheduleSnapshot, setSchedules } from "@/lib/carousel/schedule";
import { toClient } from "@/lib/carousel/view";
import { DEFAULT_TIME_ZONE } from "@/lib/carousel/timezone";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Отложенная публикация: назначить или перенести (localTime + timeZone + accountId + revision),
 * обновить снимок одобренной версии после правок (action=refresh). Аккаунт закрепляется
 * здесь, время хранится в UTC.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await readBody(req);
    if (body.action === "refresh") return ok(toClient(refreshScheduleSnapshot(id, body.revision, Date.now(), body.scheduleId)));

    if (body.platform !== undefined && !["instagram", "threads", "both"].includes(body.platform)) return ok({error:"Неизвестная площадка"},400);
    const threads = body.platform === "threads" || body.platform === "both" ? await threadsAccountInfo() : null;
    const chosen = findInstagramAccount(typeof body.accountId === "string" ? body.accountId : null);
    const wantIg = body.platform !== "threads";
    const wantThreads = body.platform === "threads" || body.platform === "both";
    const ig = instagramAccountInfo(chosen?.id ?? null);
    const problems = [...(wantIg ? ig.problems : []), ...(wantThreads ? threads?.problems ?? [] : [])];
    if ((wantIg && !chosen) || (wantThreads && (!threads?.account || threads.account.id !== (body.platform === "both" ? body.threadsAccountId : body.accountId))) || problems.length) return ok({error: problems.join(" ") || "Выберите подключённый аккаунт"}, 400);
    const now = Date.now();
    const timeZone = typeof body.timeZone === "string" && body.timeZone ? body.timeZone : DEFAULT_TIME_ZONE;
    const common = {localTime: body.immediate === true ? utcToZonedLocal(now, timeZone) : String(body.localTime ?? ""), timeZone, revision: body.revision};
    const targets = [
      ...(wantIg ? [{...common, account: toPublishAccount(chosen!)}] : []),
      ...(wantThreads ? [{...common, account: threads!.account!, caption: typeof body.caption === "string" ? body.caption.trim() : undefined}] : []),
    ];
    const c = setSchedules(id, targets, now, body.immediate === true);
    if (body.immediate === true) { runSchedulerTick(); return ok(toClient(getCarousel(id)!), 202); }
    return ok(toClient(c));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    return ok(toClient(cancelSchedule(id, Date.now(), req.nextUrl.searchParams.get("scheduleId") ?? undefined)));
  } catch (e) {
    return fail(e);
  }
}
