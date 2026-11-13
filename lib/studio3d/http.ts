import fs from "fs";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";

/** Small helpers shared by the /api/3d routes. */

export type IdCtx = { params: Promise<{ id: string }> };
export type IdKeyCtx = { params: Promise<{ id: string; key: string }> };

export const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Store errors carry their HTTP status; checked by shape, since each route bundle has its own class copy. */
export function errorResponse(e: unknown): NextResponse {
  const err = e as { name?: unknown; status?: unknown; message?: unknown };
  if (err?.name === "Studio3DError" && typeof err.status === "number") return fail(String(err.message), err.status);
  console.error("3Д:", e);
  return fail("Внутренняя ошибка сервера — повторите через минуту", 500);
}

/** The JSON body as an object; anything else is a 400 before the handler looks at fields. */
export async function readBody(req: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {}
  return fail("Тело запроса должно быть JSON-объектом", 400);
}

/**
 * A raw upload body up to `max` bytes. The declared length is checked before reading and the real one
 * while reading: a client that lies about Content-Length still cannot make the server hold more.
 */
export async function readRaw(req: NextRequest, max: number, tooBig: string): Promise<Buffer | NextResponse> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) return fail(tooBig, 413);
  if (!req.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel().catch(() => {});
      return fail(tooBig, 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

const stream = (file: string, opts?: { start: number; end: number }) => Readable.toWeb(fs.createReadStream(file, opts)) as unknown as BodyInit;

/** A stored file with Range support (seeking in the player); 404 when it is gone from the disk. */
export function fileResponse(req: NextRequest, file: string, headers: Record<string, string>): NextResponse {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return fail("Файл не найден", 404);
  }
  const base = { ...headers, "Accept-Ranges": "bytes" };
  const m = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start: number;
    let end: number;
    if (m[1]) {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    } else {
      // «bytes=-N»: the last N bytes
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
    }
    return new NextResponse(stream(file, { start, end }), {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new NextResponse(stream(file), { headers: { ...base, "Content-Length": String(size) } });
}
