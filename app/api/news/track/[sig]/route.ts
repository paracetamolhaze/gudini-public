import { NextRequest } from "next/server";
import { trackFile } from "@/lib/news/store";
import { fail, fileResponse } from "@/lib/news/http";

/** Подготовленный кусок трека для плеера «Монтажа»; sig меняется вместе с файлом, поэтому кэш бессрочный. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ sig: string }> }) {
  const { sig } = await params;
  const file = trackFile(sig);
  if (!file) return fail("Трека нет на сайте", 404);
  return fileResponse(req, file, { "Content-Type": "audio/mp4", "Cache-Control": "private, max-age=31536000, immutable" });
}
