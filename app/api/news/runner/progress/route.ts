import { NextRequest, NextResponse } from "next/server";
import { isProjectId, reportProgress } from "@/lib/news/store";
import { errorResponse, fail, readBody } from "@/lib/news/http";

/** Шаг и прогресс задачи — заодно признак жизни исполнителя. 409 — задача уже не эта. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  if (!isProjectId(body.id)) return fail("Недопустимый id ролика", 400);
  try {
    const job = await reportProgress(body.id, body.jobId, body.step, body.progress);
    return NextResponse.json({ ok: true, progress: job.progress });
  } catch (e) {
    return errorResponse(e);
  }
}
