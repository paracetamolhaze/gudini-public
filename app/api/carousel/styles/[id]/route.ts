import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { fail, guard } from "@/lib/carousel/http";
import { notFound } from "@/lib/carousel/store";
import { isStyleId } from "@/lib/carousel/styles/catalog";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Миниатюра стиля для выбора в кнопке «Создать»: обложка одобренного образца. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!isStyleId(id)) throw notFound();
    const file = path.join(process.cwd(), "lib", "carousel", "styles", "thumbs", `${id}.jpg`);
    if (!fs.existsSync(file)) throw notFound();
    const data = fs.readFileSync(file);
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": "image/jpeg", "Content-Length": String(data.length), "Cache-Control": "private, max-age=86400" } });
  } catch (e) {
    return fail(e);
  }
}
