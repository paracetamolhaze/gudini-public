import { NextRequest, NextResponse } from "next/server";
import { MAX_TRACK_BYTES, receiveTrack } from "@/lib/news/store";
import { errorResponse, fail } from "@/lib/news/http";

/**
 * Исполнитель присылает подготовленный кусок трека (лучшая часть, громкость выровнена) — один раз на sig, целиком
 * одним телом. Принимается только трек из списка, который он сам прислал в claim; после этого трек на странице
 * играет и склеивается сразу.
 */
export async function PUT(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  // до чтения тела: не принимать в память файл, который всё равно не возьмём
  if (Number(req.headers.get("content-length") ?? 0) > MAX_TRACK_BYTES) return fail("Трек больше 40 МБ", 413);
  try {
    await receiveTrack(q.get("file"), q.get("sig"), Buffer.from(await req.arrayBuffer()));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
