import { NextRequest, NextResponse } from "next/server";
import { isProjectId, setMusic, trackViews } from "@/lib/news/store";
import { toView } from "@/lib/news/rules";
import { afterVideoChange, errorResponse, fail, readBody, type IdCtx } from "@/lib/news/http";

/**
 * { music: "<файл трека>" | null } — другой трек под готовым роликом (или без музыки): сайт сам склеивает out.mp4 из
 * основы без музыки за секунду-две, ПК не нужен. Трек — только из списка с ПК. Тот же выбор ничего не меняет.
 */
export async function POST(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  try {
    const before = Date.now();
    const project = await setMusic(id, body.music);
    if (project.video && Date.parse(project.video.at) >= before) afterVideoChange(id);
    return NextResponse.json({ ...toView(project), tracks: trackViews() });
  } catch (e) {
    return errorResponse(e);
  }
}
