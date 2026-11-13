import { NextRequest } from "next/server";
import { getProject, isProjectId, lineClipFile } from "@/lib/studio3d/store";
import { isLineKey } from "@/lib/studio3d/rules";
import { fail, fileResponse, type IdKeyCtx } from "@/lib/studio3d/http";

/** Озвученная реплика из задачи «подсказки»: Клод перед записью и «Оригинал» для сравнения. */
export async function GET(req: NextRequest, { params }: IdKeyCtx) {
  const { id, key } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  if (!isLineKey(key)) return fail("Недопустимый ключ реплики", 400);
  if (!getProject(id)) return fail("Проект не найден", 404);
  const found = lineClipFile(id, key);
  if (!found) return fail("Подсказки для этой реплики нет", 404);
  const fresh = req.nextUrl.searchParams.get("v") === found.clip.at;
  return fileResponse(req, found.file, {
    "Content-Type": "audio/mpeg",
    "Cache-Control": fresh ? "private, max-age=31536000, immutable" : "private, no-cache",
  });
}
