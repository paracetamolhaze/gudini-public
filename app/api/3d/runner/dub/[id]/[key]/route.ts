import fs from "fs";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { isJobId, isProjectId, runnerDubTake } from "@/lib/studio3d/store";
import { isLineKey } from "@/lib/studio3d/rules";
import { errorResponse, fail, type IdKeyCtx } from "@/lib/studio3d/http";

/**
 * Запись владельца для идущего монтажа или сборки с его голосом: ?jobId=…&take=… из плана озвучки. Заголовок x-sha256 —
 * исполнитель сверяет файл; другой дубль или чужая задача — 409.
 */
export async function GET(req: NextRequest, { params }: IdKeyCtx) {
  const { id, key } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  if (!isLineKey(key)) return fail("Недопустимый ключ реплики", 400);
  const q = req.nextUrl.searchParams;
  const jobId = q.get("jobId");
  if (!isJobId(jobId)) return fail("Нужен jobId", 400);
  const take = q.get("take");
  if (!take || !/^\d+$/.test(take)) return fail("Нужен номер дубля take", 400);
  try {
    const t = runnerDubTake(id, jobId, key, Number(take));
    let size: number;
    try {
      size = fs.statSync(t.file).size;
    } catch {
      return fail("Файл записи не найден", 404);
    }
    return new NextResponse(Readable.toWeb(fs.createReadStream(t.file)) as unknown as BodyInit, {
      headers: { "Content-Type": "audio/flac", "Content-Length": String(size), "x-sha256": t.sha256, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
