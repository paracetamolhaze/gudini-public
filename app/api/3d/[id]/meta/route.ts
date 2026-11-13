import { NextRequest, NextResponse } from "next/server";
import { isProjectId } from "@/lib/studio3d/store";
import { toView } from "@/lib/studio3d/rules";
import { checkMeta, regenerateMeta, saveMeta } from "@/lib/studio3d/meta";
import { syncMirror } from "@/lib/studio3d/publish";
import { errorResponse, fail, readBody, type IdCtx } from "@/lib/studio3d/http";

/** Caption for the networks: POST writes another one from the dialogue (one paid call), PUT saves the owner's edit. */

export async function POST(_req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  try {
    const project = await regenerateMeta(id);
    // the mirror carries the caption for the networks; not awaited: a publication in progress may hold it
    void syncMirror(id);
    return NextResponse.json(toView(project));
  } catch (e) {
    return errorResponse(e);
  }
}

/** { title, description, hashtags } — all three, checked whole: nothing is cut to fit. */
export async function PUT(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  try {
    const project = await saveMeta(id, checkMeta(body));
    void syncMirror(id);
    return NextResponse.json(toView(project));
  } catch (e) {
    return errorResponse(e);
  }
}
