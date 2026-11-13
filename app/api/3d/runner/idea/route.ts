import { NextRequest, NextResponse } from "next/server";
import { isProjectId } from "@/lib/studio3d/store";
import { chooseIdea } from "@/lib/studio3d/ideas";
import { errorResponse, fail, readBody } from "@/lib/studio3d/http";

/** Выбранная идея ролика «Создать видео»: { key — карточка тренда или null, topic }. В ответ — тема и пожелания сценаристу. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  if (!isProjectId(body.id)) return fail("Недопустимый id проекта", 400);
  try {
    const project = await chooseIdea(body.id, body.jobId, body.key, body.topic);
    return NextResponse.json({ ok: true, topic: project.topic, notes: project.notes ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}
