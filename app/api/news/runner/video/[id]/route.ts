import { NextRequest, NextResponse } from "next/server";
import { isJobId, isProjectId, MAX_VIDEO_BYTES, receiveVideoChunk } from "@/lib/news/store";
import { errorResponse, fail, type IdCtx } from "@/lib/news/http";

const int = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : NaN);

/**
 * Исполнитель заливает ролик кусками, как исполнитель 3Д: x-offset и x-file-size, при расхождении 409 { received } —
 * с этого места он и продолжает. Только для идущей задачи ?jobId=; на место out.mp4 файл встанет при её завершении.
 */
export async function PUT(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!isJobId(jobId)) return fail("Нужен jobId", 400);
  const offset = int(req.headers.get("x-offset"));
  const total = int(req.headers.get("x-file-size"));
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(total) || total <= 0) return fail("Нужны заголовки x-offset и x-file-size", 400);
  // до чтения тела: не принимать в память кусок файла, который всё равно не возьмём
  if (total > MAX_VIDEO_BYTES) return fail("Видео больше 2 ГБ", 413);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_VIDEO_BYTES) return fail("Кусок слишком большой", 413);
  try {
    const data = Buffer.from(await req.arrayBuffer());
    const r = await receiveVideoChunk(id, jobId, offset, total, data);
    if ("resync" in r) return NextResponse.json({ error: "рассинхрон", received: r.resync }, { status: 409 });
    if ("done" in r) return NextResponse.json({ done: true, size: r.size });
    return NextResponse.json({ ok: true, received: r.received });
  } catch (e) {
    return errorResponse(e);
  }
}
