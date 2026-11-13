import { NextRequest, NextResponse } from "next/server";
import { isProjectId, reportProgress } from "@/lib/studio3d/store";
import { errorResponse, fail, readBody } from "@/lib/studio3d/http";

/** Шаг и прогресс задачи — заодно признак жизни контейнера. 409 — задача уже не эта. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  if (!isProjectId(body.id)) return fail("Недопустимый id проекта", 400);
  try {
    const job = await reportProgress(body.id, body.jobId, body.step, body.progress);
    return NextResponse.json({ ok: true, progress: job.progress });
  } catch (e) {
    return errorResponse(e);
  }
}
