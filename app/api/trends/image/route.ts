import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { cardDir, FRAME_RE, isCardKey } from "@/lib/trends/state";

export const runtime = "nodejs";

/** Кадр карточки: /api/trends/image?key=instagram:ABC&n=1. */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const name = `frame-${req.nextUrl.searchParams.get("n")}.jpg`;
  if (!isCardKey(key) || !FRAME_RE.test(name)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const data = fs.readFileSync(path.join(cardDir(key), name));
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
