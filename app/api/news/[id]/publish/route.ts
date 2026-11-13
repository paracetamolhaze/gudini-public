import { NextRequest, NextResponse } from "next/server";
import { isProjectId } from "@/lib/news/store";
import { cancelNews, checkPublishRequest, publishNews, publishView } from "@/lib/news/publish";
import { errorResponse, fail, readBody, type IdCtx } from "@/lib/news/http";

/**
 * Publishing a news video to TikTok, YouTube Shorts and Instagram Reels through its hidden main-site mirror
 * (lib/news/publish.ts): the live main publishing code does the sending, drafts, schedules and trial Reels.
 */

/** The mirror's publications with the live overlays, connected accounts, and whether a cover is still being made. */
export async function GET(_req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  try {
    return NextResponse.json(publishView(id));
  } catch (e) {
    return errorResponse(e);
  }
}

/** { platform, mode?: "live" | "draft", scheduledAt?, instagramTrial? } → { publication, view }. */
export async function POST(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  try {
    return NextResponse.json(await publishNews(id, checkPublishRequest(body)));
  } catch (e) {
    return errorResponse(e);
  }
}

/** { platform } — cancels a scheduled or queued send that has not started; YouTube schedules live in YouTube Studio. */
export async function DELETE(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  try {
    return NextResponse.json({ ok: true, view: await cancelNews(id, body.platform) });
  } catch (e) {
    return errorResponse(e);
  }
}
