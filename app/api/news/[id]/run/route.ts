import { NextRequest, NextResponse } from "next/server";
import { cancelQueued, enqueueRerender, isProjectId, recreate } from "@/lib/news/store";
import { toView } from "@/lib/news/rules";
import { errorResponse, fail, readOptionalBody, type IdCtx } from "@/lib/news/http";

/**
 * «Создать заново»: ещё одна задача create на этом же ролике — после ошибки или пропавшего исполнителя, пока
 * готового видео нет. Тело не нужно. { task: "rerender" } — тот же ролик заново по его раскладке (после правки
 * монтажа), выбранный трек остаётся; музыка меняется через /music без ПК.
 */
export async function POST(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  const body = await readOptionalBody(req);
  if (body instanceof NextResponse) return body;
  if (body.task !== undefined && body.task !== "create" && body.task !== "rerender") return fail("Неизвестная задача: здесь create или rerender, музыка меняется через /music", 400);
  try {
    return NextResponse.json(toView(body.task === "rerender" ? await enqueueRerender(id) : await recreate(id)));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Снять задачу, которую ПК ещё не взял (например, он выключен). */
export async function DELETE(_req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  try {
    return NextResponse.json(toView(await cancelQueued(id)));
  } catch (e) {
    return errorResponse(e);
  }
}
