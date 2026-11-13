import fs from "fs";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { getProject, isProjectId, videoPath } from "@/lib/studio3d/store";
import { projectTitle } from "@/lib/studio3d/rules";
import { fail, type IdCtx } from "@/lib/studio3d/http";

/** Имя файла для «Скачать»: название скетча без знаков, которые ломают файловые системы. */
function downloadName(title: string): string {
  const base = title.replace(/[^\p{L}\p{N} _-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  return `${base || "3d"}.mp4`;
}

/** RFC 5987: encodeURIComponent оставляет ' ( ) * — их тоже кодируем. */
const encode5987 = (s: string) => encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const body = (file: string, opts?: { start: number; end: number }) => Readable.toWeb(fs.createReadStream(file, opts)) as unknown as BodyInit;

/** Готовый ролик с поддержкой Range (перемотка в плеере); ?download=1 — скачать файлом. */
export async function GET(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id проекта", 400);
  const project = getProject(id);
  if (!project) return fail("Проект не найден", 404);
  if (!project.video) return fail("Видео ещё нет", 404);
  const file = videoPath(id);
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return fail("Файл видео не найден", 404);
  }

  const q = req.nextUrl.searchParams;
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    // ?v= меняется с каждым монтажом, поэтому ссылку с ним можно хранить в кэше браузера
    "Cache-Control": q.get("v") === project.video.at ? "private, max-age=31536000, immutable" : "private, no-cache",
  };
  if (q.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename="gudini-3d-${id}.mp4"; filename*=UTF-8''${encode5987(downloadName(projectTitle(project)))}`;
  }

  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start: number;
    let end: number;
    if (m[1]) {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    } else {
      // «bytes=-N» — последние N байт
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    return new NextResponse(body(file, { start, end }), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new NextResponse(body(file), { headers: { ...headers, "Content-Length": String(size) } });
}
