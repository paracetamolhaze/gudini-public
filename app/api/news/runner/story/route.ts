import { NextRequest, NextResponse } from "next/server";
import { isProjectId, setStory } from "@/lib/news/store";
import { errorResponse, fail, readBody } from "@/lib/news/http";

/** Найденная история задачи create — страница показывает её, пока ролик монтируется. Неверная отклоняется целиком (400). */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  if (!isProjectId(body.id)) return fail("Недопустимый id ролика", 400);
  try {
    const project = await setStory(body.id, body.jobId, body.story);
    return NextResponse.json({ ok: true, title: project.story?.title ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}
