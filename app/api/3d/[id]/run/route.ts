import { NextRequest, NextResponse } from "next/server";
import { cancelQueued, enqueue, isProjectId } from "@/lib/studio3d/store";
import { toView } from "@/lib/studio3d/rules";
import { errorResponse, fail, readBody, type IdCtx } from "@/lib/studio3d/http";

/**
 * Поставить задачу исполнителю 3Д: { task: "script" | "voice" | "montage" | "dub" }. voice — реплики по одной (и разметка
 * старого ролика), dub — тот же ролик заново с записями владельца поверх него.
 */
export async function POST(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  try {
    return NextResponse.json(toView(await enqueue(id, body.task)));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Снять задачу, которую контейнер ещё не взял (например, он выключен). */
export async function DELETE(_req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  try {
    return NextResponse.json(toView(await cancelQueued(id)));
  } catch (e) {
    return errorResponse(e);
  }
}
