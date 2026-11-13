import { NextRequest, NextResponse } from "next/server";
import { isJobId, isProjectId, saveLineClip } from "@/lib/studio3d/store";
import { isLineKey } from "@/lib/studio3d/rules";
import { MAX_CLIP_BYTES } from "@/lib/studio3d/types";
import { errorResponse, fail, readRaw, type IdKeyCtx } from "@/lib/studio3d/http";

/** Одна озвученная реплика задачи «подсказки»: mp3 целиком, ?jobId=…&duration=… (секунды). */
export async function PUT(req: NextRequest, { params }: IdKeyCtx) {
  const { id, key } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  if (!isLineKey(key)) return fail("Недопустимый ключ реплики", 400);
  const q = req.nextUrl.searchParams;
  const jobId = q.get("jobId");
  if (!isJobId(jobId)) return fail("Нужен jobId", 400);
  const data = await readRaw(req, MAX_CLIP_BYTES, `Реплика больше ${MAX_CLIP_BYTES / 1024 / 1024} МБ`);
  if (data instanceof NextResponse) return data;
  try {
    const clip = await saveLineClip(id, jobId, key, data, q.get("duration") ?? "");
    return NextResponse.json({ ok: true, clip });
  } catch (e) {
    return errorResponse(e);
  }
}
