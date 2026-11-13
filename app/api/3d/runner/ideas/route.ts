import { NextRequest, NextResponse } from "next/server";
import { isProjectId } from "@/lib/studio3d/store";
import { ideaPool } from "@/lib/studio3d/ideas";
import { errorResponse, fail, readBody } from "@/lib/studio3d/http";

/** Из чего исполнитель выбирает идею ролика «Создать видео»: неснятые сценки из трендов и темы последних скетчей. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  if (!isProjectId(body.id)) return fail("Недопустимый id проекта", 400);
  try {
    return NextResponse.json(ideaPool(body.id, body.jobId));
  } catch (e) {
    return errorResponse(e);
  }
}
