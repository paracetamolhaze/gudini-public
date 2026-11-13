import { NextRequest, NextResponse } from "next/server";
import { completeJob, isProjectId } from "@/lib/studio3d/store";
import { errorResponse, fail, readBody } from "@/lib/studio3d/http";

/**
 * Конец задачи: { error } или, для монтажа и сборки с голосом владельца, { video: { duration, scriptVersion, lines } }
 * после загрузки out.mp4; подсказки могут прислать videoLines — разметку реплик ролика, снятого до её хранения.
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  if (!isProjectId(body.id)) return fail("Недопустимый id проекта", 400);
  try {
    const project = await completeJob(body.id, body.jobId, { error: body.error, video: body.video, videoLines: body.videoLines });
    // a dub is a new video too: the mirror gets it, the cover and caption stay
    const madeVideo = project.job?.task === "montage" || project.job?.task === "dub";
    if (madeVideo && project.job?.state === "done" && project.video) prepareForPublishing(body.id);
    return NextResponse.json({ ok: true, job: project.job });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * A fresh video gets its cover and caption in the background (lib/studio3d/publish.ts afterMontage): the runner
 * is answered at once and never waits for paid model calls. Off under `node --test` — the route tests finish
 * montages in a temp folder and must reach neither the models nor the site's db.json.
 */
function prepareForPublishing(id: string) {
  if (process.env.NODE_TEST_CONTEXT || process.env.STUDIO3D_AUTO_PREP === "off") return;
  void import("@/lib/studio3d/publish")
    .then((m) => m.afterMontage(id))
    .catch((e) => console.warn(`3Д ${id}: обложка и описание после монтажа не сделаны:`, (e as Error)?.message ?? e));
}
