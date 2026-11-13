import { NextRequest } from "next/server";
import { fail, guard, ok, readBody } from "@/lib/carousel/http";
import { CarouselError, updateCarousel } from "@/lib/carousel/store";
import { toClient } from "@/lib/carousel/view";

export const dynamic = "force-dynamic";

/** Ручная отметка «Опубликована»: владелец залил карусель с телефона сам. published: false снимает отметку. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await readBody(req);
    if (typeof body.published !== "boolean") throw new CarouselError("Нужно published: true или false", 400, "bad_request");
    const c = updateCarousel(id, (x) => { x.manualPublishedAt = body.published ? new Date().toISOString() : undefined; });
    return ok(toClient(c));
  } catch (e) {
    return fail(e);
  }
}
