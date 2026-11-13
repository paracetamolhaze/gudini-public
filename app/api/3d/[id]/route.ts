import { NextRequest, NextResponse } from "next/server";
import { getProject, isProjectId, patchProject } from "@/lib/studio3d/store";
import { toView } from "@/lib/studio3d/rules";
import { removeProject3D } from "@/lib/studio3d/publish";
import { errorResponse, fail, readBody, type IdCtx } from "@/lib/studio3d/http";

export async function GET(_req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  const project = getProject(id);
  if (!project) return fail("Проект не найден", 404);
  return NextResponse.json(toView(project));
}

/** Правки владельца: идея, пожелания, сценарий, «Мой голос» (ownVoice). Пока идёт задача — 409. */
export async function PATCH(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  try {
    return NextResponse.json(toView(await patchProject(id, { topic: body.topic, notes: body.notes, script: body.script, ownVoice: body.ownVoice })));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Скетч вместе с его скрытым зеркалом публикаций; опубликованное остаётся в соцсетях. */
export async function DELETE(_req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  try {
    await removeProject3D(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
