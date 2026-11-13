import { NextRequest, NextResponse } from "next/server";
import { getProject, isProjectId } from "@/lib/news/store";
import { toView } from "@/lib/news/rules";
import { checkHeadline, coverFile, isCoverStyle, makeNewsCover } from "@/lib/news/cover";
import { syncMirror } from "@/lib/news/publish";
import { errorResponse, fail, fileResponse, readBody, type IdCtx } from "@/lib/news/http";

/** The cover picture; ?v=<cover.at> changes with every new cover, so such a link may be cached for good. */
export async function GET(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  const project = getProject(id);
  if (!project) return fail("Ролик не найден", 404);
  const file = coverFile(project);
  if (!file) return fail("Обложки нет", 404);
  const cached = req.nextUrl.searchParams.get("v") === project.cover?.at;
  return fileResponse(req, file, {
    "Content-Type": "image/jpeg",
    "Cache-Control": cached ? "private, max-age=31536000, immutable" : "private, no-cache",
  });
}

/**
 * A new cover: one image per press (a misspelt headline is drawn once more). { headline? } — the owner's own headline,
 * { style? } — «post», «poster» or «news»; without it — «post», the owner on the blue background (owner 3.11).
 * When the new one fails, the previous cover stays and the answer is 409 with the reason.
 */
export async function POST(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  try {
    if (body.style !== undefined && !isCoverStyle(body.style)) return fail("Стиль обложки — hero, post, poster или news", 400);
    const result = await makeNewsCover(id, { headline: checkHeadline(body.headline), ...(isCoverStyle(body.style) ? { style: body.style } : {}) });
    // not awaited: a publication in progress may hold the mirror; the next one syncs anyway
    if (result.ok) void syncMirror(id);
    if (result.kept) return NextResponse.json({ error: result.error, project: toView(result.project) }, { status: 409 });
    return NextResponse.json(toView(result.project));
  } catch (e) {
    return errorResponse(e);
  }
}
