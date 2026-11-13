import { NextRequest, NextResponse } from "next/server";
import { isProjectId, setScriptFromRunner } from "@/lib/studio3d/store";
import { errorResponse, fail, readBody } from "@/lib/studio3d/http";

/** Готовый диалог задачи «script». Неверный сценарий отклоняется целиком (400), ничего не обрезается. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  if (!isProjectId(body.id)) return fail("Недопустимый id проекта", 400);
  try {
    const project = await setScriptFromRunner(body.id, body.jobId, body.script);
    return NextResponse.json({ ok: true, scriptVersion: project.scriptVersion });
  } catch (e) {
    return errorResponse(e);
  }
}
