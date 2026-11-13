import { NextRequest, NextResponse } from "next/server";
import { fail } from "../studio3d/http";

/** Small helpers shared by the /api/news routes: the 3D ones where they fit, the error answer of our own. */

export { fail, fileResponse, readBody, type IdCtx } from "../studio3d/http";

/** Store errors carry their HTTP status; checked by shape, since each route bundle has its own class copy. */
export function errorResponse(e: unknown): NextResponse {
  const err = e as { name?: unknown; status?: unknown; message?: unknown };
  if (err?.name === "NewsError" && typeof err.status === "number") return fail(String(err.message), err.status);
  console.error("Новости:", e);
  return fail("Внутренняя ошибка сервера — повторите через минуту", 500);
}

/**
 * A new out.mp4 (a render or another track) gets its cover and caption if it has none, and an existing mirror gets
 * the new file, in the background (lib/news/publish.ts afterMontage): the caller is answered at once and never waits
 * for paid model calls. Off under `node --test` — the route tests work in a temp folder and must reach neither the
 * models nor the site's db.json.
 */
export function afterVideoChange(id: string) {
  if (process.env.NODE_TEST_CONTEXT || process.env.NEWS_AUTO_PREP === "off") return;
  void import("./publish")
    .then((m) => m.afterMontage(id))
    .catch((e) => console.warn(`Новости ${id}: обложка и описание после ролика не сделаны:`, (e as Error)?.message ?? e));
}

/** A body that may be left out: nothing (or only spaces) is {}, anything else must be a JSON object. */
export async function readOptionalBody(req: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  const text = await req.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {}
  return fail("Тело запроса должно быть JSON-объектом", 400);
}
