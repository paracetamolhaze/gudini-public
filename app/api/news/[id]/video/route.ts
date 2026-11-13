import { NextRequest } from "next/server";
import { basePath, getProject, isProjectId, videoPath } from "@/lib/news/store";
import { projectTitle } from "@/lib/news/rules";
import { fail, fileResponse, type IdCtx } from "@/lib/news/http";

/** Имя файла для «Скачать»: заголовок истории без знаков, которые ломают файловые системы. */
function downloadName(title: string): string {
  const base = title.replace(/[^\p{L}\p{N} _-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  return `${base || "news"}.mp4`;
}

/** RFC 5987: encodeURIComponent оставляет ' ( ) * — их тоже кодируем. */
const encode5987 = (s: string) => encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Готовый ролик с поддержкой Range (перемотка в плеере); ?download=1 — скачать файлом. ?base=1 — монтаж ПК без
 * музыки: плеер «Монтажа» играет его с треком в браузере, поэтому треки переключаются сразу.
 */
export async function GET(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  if (!isProjectId(id)) return fail("Недопустимый id ролика", 400);
  const project = getProject(id);
  if (!project) return fail("Ролик не найден", 404);
  if (!project.video) return fail("Видео ещё нет", 404);
  const q = req.nextUrl.searchParams;
  const base = q.get("base") === "1";
  if (base && !project.video.base) return fail("Основы без музыки у этого ролика нет", 404);
  const version = base ? project.video.base!.at : project.video.at;
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    // ?v= меняется с каждым новым файлом (у out.mp4 — и со сменой музыки), поэтому ссылку с ним можно кэшировать
    "Cache-Control": q.get("v") === version ? "private, max-age=31536000, immutable" : "private, no-cache",
  };
  if (q.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename="gudini-news-${id}.mp4"; filename*=UTF-8''${encode5987(downloadName(projectTitle(project)))}`;
  }
  return fileResponse(req, base ? basePath(id) : videoPath(id), headers);
}
