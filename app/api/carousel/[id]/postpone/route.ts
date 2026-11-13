import { NextRequest } from "next/server";
import { fail, guard, ok, readBody } from "@/lib/carousel/http";
import { CarouselError, isJobPending, updateCarousel } from "@/lib/carousel/store";
import { isMemeCarousel } from "@/lib/carousel/meme";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await readBody(req);
    if (typeof body.archived !== "boolean") throw new CarouselError("Нужно archived: true или false", 400, "bad_request");
    updateCarousel(id, c => {
      if (!isMemeCarousel(c)) throw new CarouselError("Это не карусель из мемов", 400, "bad_request");
      if (isJobPending(c.job) || [...(c.schedules ?? []), ...(c.schedule ? [c.schedule] : [])].some(s => ["scheduled", "queued", "publishing"].includes(s.status))) throw new CarouselError("Дождитесь завершения задания или отмените расписание", 409, "busy");
      c.archivedAt = body.archived ? new Date().toISOString() : undefined;
    });
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}
