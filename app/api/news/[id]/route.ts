import { NextRequest, NextResponse } from "next/server";
import { getProject, isProjectId, mutate, trackViews } from "@/lib/news/store";
import { toView } from "@/lib/news/rules";
import { removeNews } from "@/lib/news/publish";
import { errorResponse, fail, readBody, type IdCtx } from "@/lib/news/http";

/** Ролик со статусом задачи; tracks — музыка с ПК для выбора на этапе «Монтаж». */
export async function GET(_req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  const project = getProject(id);
  if (!project) return fail("Ролик не найден", 404);
  return NextResponse.json({ ...toView(project), tracks: trackViews() });
}

/** { rework: true|false } — отложить ролик во вкладку «Доработка» или вернуть в «Готовые». Больше ничего не меняет. */
export async function PATCH(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  if (typeof body.rework !== "boolean") return fail("Нужно поле rework: true или false", 400);
  try {
    const { project } = await mutate(id, (p) => {
      if (body.rework) p.rework = true;
      else delete p.rework;
    });
    return NextResponse.json({ id: project.id, rework: project.rework === true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Ролик вместе с его скрытым зеркалом публикаций; опубликованное остаётся в соцсетях. */
export async function DELETE(_req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  try {
    await removeNews(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
