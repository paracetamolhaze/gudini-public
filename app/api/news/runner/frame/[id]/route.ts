import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getProject, isJobId, isProjectId, projectDir } from "@/lib/news/store";
import { COVER_FRAME_FILE } from "@/lib/news/cover";
import { errorResponse, fail, type IdCtx } from "@/lib/news/http";

const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/**
 * Чистый кадр для обложки: исполнитель берёт его из ролика героя (первый план, без субтитров и вставок) и кладёт рядом с
 * роликом. Обложка собирается на нём (lib/news/cover.ts), а не на кадре готового ролика с субтитрами. Только для идущей
 * задачи ?jobId=.
 */
export async function PUT(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!isJobId(jobId)) return fail("Нужен jobId", 400);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_FRAME_BYTES) return fail("Кадр больше 8 МБ", 413);
  try {
    const p = getProject(id);
    if (!p) return fail("Ролик не найден", 404);
    if (p.job?.id !== jobId) return fail("Задание уже не это", 409);
    const data = Buffer.from(await req.arrayBuffer());
    // JPEG начинается с FF D8
    if (data.length < 1024 || data.length > MAX_FRAME_BYTES || data[0] !== 0xff || data[1] !== 0xd8) return fail("Нужен кадр JPEG", 400);
    const dir = projectDir(id);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `${COVER_FRAME_FILE}.part`);
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, path.join(dir, COVER_FRAME_FILE));
    return NextResponse.json({ ok: true, size: data.length });
  } catch (e) {
    return errorResponse(e);
  }
}
