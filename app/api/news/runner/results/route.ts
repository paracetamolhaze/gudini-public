import { NextResponse } from "next/server";
import { newsResults } from "@/lib/news/results";
import { errorResponse } from "@/lib/news/http";

// статистика читается с диска на каждый запрос
export const dynamic = "force-dynamic";

/** Исполнитель на ПК: как зашли опубликованные ролики «Новостей» — он ищет истории и зачины, похожие на лучшие. */
export async function GET() {
  try {
    return NextResponse.json({ results: newsResults() });
  } catch (e) {
    return errorResponse(e);
  }
}
