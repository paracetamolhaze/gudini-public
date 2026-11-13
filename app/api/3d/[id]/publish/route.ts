import { NextRequest, NextResponse } from "next/server";
import { isProjectId } from "@/lib/studio3d/store";
import { cancel3D, checkPublishRequest, publish3D, publishView } from "@/lib/studio3d/publish";
import { errorResponse, fail, readBody, type IdCtx } from "@/lib/studio3d/http";

/**
 * Publishing a 3D video to TikTok, YouTube Shorts and Instagram Reels through its hidden main-site mirror
 * (lib/studio3d/publish.ts): the live main publishing code does the sending, drafts, schedules and trial Reels.
 */

/** The mirror's publications with the live overlays, connected accounts, and whether a cover is still being made. */
export async function GET(_req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  try {
    return NextResponse.json(publishView(id));
  } catch (e) {
    return errorResponse(e);
  }
}

/** { platform, mode?: "live" | "draft", scheduledAt?, instagramTrial? } → { publication, view }. */
export async function POST(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  try {
    return NextResponse.json(await publish3D(id, checkPublishRequest(body)));
  } catch (e) {
    return errorResponse(e);
  }
}

/** { platform } — cancels a scheduled or queued send that has not started; YouTube schedules live in YouTube Studio. */
export async function DELETE(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  try {
    return NextResponse.json({ ok: true, view: await cancel3D(id, body.platform) });
  } catch (e) {
    return errorResponse(e);
  }
}
