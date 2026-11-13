import { NextRequest, NextResponse } from "next/server";
import { completeJob, isProjectId } from "@/lib/news/store";
import { afterVideoChange, errorResponse, fail, readBody } from "@/lib/news/http";

/**
 * Конец задачи: { error } или, после загрузки ролика без музыки, { video: { duration, music } } — и для create, и для
 * rerender; out.mp4 с треком склеивает сайт.
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  if (!isProjectId(body.id)) return fail("Недопустимый id ролика", 400);
  try {
    const project = await completeJob(body.id, body.jobId, { error: body.error, video: body.video });
    // a rerender is a new video too: the mirror gets it, the cover and caption stay
    if (project.job?.state === "done" && project.video) afterVideoChange(body.id);
    return NextResponse.json({ ok: true, job: project.job });
  } catch (e) {
    return errorResponse(e);
  }
}

