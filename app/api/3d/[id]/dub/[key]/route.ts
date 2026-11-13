import { NextRequest, NextResponse } from "next/server";
import { dubTakeFile, getProject, isProjectId, removeDubTake, saveDubTake } from "@/lib/studio3d/store";
import { isLineKey, toView } from "@/lib/studio3d/rules";
import { MAX_DUB_BYTES } from "@/lib/studio3d/types";
import { errorResponse, fail, fileResponse, readRaw, type IdKeyCtx } from "@/lib/studio3d/http";

/** Запись своей реплики: ?v= меняется с каждым дублем, поэтому ссылку с ним браузер хранит в кэше. */
export async function GET(req: NextRequest, { params }: IdKeyCtx) {
  const { id, key } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  if (!isLineKey(key)) return fail("Недопустимый ключ реплики", 400);
  if (!getProject(id)) return fail("Проект не найден", 404);
  const found = dubTakeFile(id, key);
  if (!found) return fail("Записи этой реплики нет", 404);
  const fresh = req.nextUrl.searchParams.get("v") === found.take.at;
  return fileResponse(req, found.file, {
    "Content-Type": "audio/flac",
    "Cache-Control": fresh ? "private, max-age=31536000, immutable" : "private, no-cache",
  });
}

/**
 * Дубль со страницы озвучки: тело — сам файл из MediaRecorder (webm, ogg, mp4, wav или mp3). Записанный поверх
 * ролика несёт отметки в адресе: ?videoStart=…&latencyMs=…&lineStart=…&lineEnd=…&videoAt=… (секунды, мс, Video3D.at).
 */
export async function PUT(req: NextRequest, { params }: IdKeyCtx) {
  const { id, key } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  if (!isLineKey(key)) return fail("Недопустимый ключ реплики", 400);
  const q = req.nextUrl.searchParams;
  const meta = { videoStart: q.get("videoStart"), latencyMs: q.get("latencyMs"), lineStart: q.get("lineStart"), lineEnd: q.get("lineEnd"), videoAt: q.get("videoAt") };
  const data = await readRaw(req, MAX_DUB_BYTES, `Запись больше ${MAX_DUB_BYTES / 1024 / 1024} МБ`);
  if (data instanceof NextResponse) return data;
  try {
    return NextResponse.json(toView(await saveDubTake(id, key, data, meta)));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: IdKeyCtx) {
  const { id, key } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  if (!isLineKey(key)) return fail("Недопустимый ключ реплики", 400);
  try {
    return NextResponse.json(toView(await removeDubTake(id, key)));
  } catch (e) {
    return errorResponse(e);
  }
}
