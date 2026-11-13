import { NextRequest, NextResponse } from "next/server";
import { getProject, isProjectId } from "@/lib/studio3d/store";
import { toView } from "@/lib/studio3d/rules";
import { checkHeadline, coverFile, makeCover3D } from "@/lib/studio3d/cover";
import { syncMirror } from "@/lib/studio3d/publish";
import { errorResponse, fail, fileResponse, readBody, type IdCtx } from "@/lib/studio3d/http";

/** The cover picture; ?v=<cover.at> changes with every new cover, so such a link may be cached for good. */
export async function GET(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  const project = getProject(id);
  if (!project) return fail("Проект не найден", 404);
  const file = coverFile(project);
  if (!file) return fail("Обложки нет", 404);
  const cached = req.nextUrl.searchParams.get("v") === project.cover?.at;
  return fileResponse(req, file, {
    "Content-Type": "image/jpeg",
    "Cache-Control": cached ? "private, max-age=31536000, immutable" : "private, no-cache",
  });
}

/**
 * A new cover: exactly one paid image per press, like the main covers. { headline? } — the owner's own headline.
 * When the new one fails, the previous cover stays and the answer is 409 with the reason.
 */
export async function POST(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  try {
    const result = await makeCover3D(id, { headline: checkHeadline(body.headline) });
    // not awaited: a publication in progress may hold the mirror; the next one syncs anyway
    if (result.ok) void syncMirror(id);
    if (result.kept) return NextResponse.json({ error: result.error, project: toView(result.project) }, { status: 409 });
    return NextResponse.json(toView(result.project));
  } catch (e) {
    return errorResponse(e);
  }
}
