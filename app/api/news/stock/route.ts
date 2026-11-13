import { NextRequest, NextResponse } from "next/server";
import { askMore, removePick, stockView } from "@/lib/news/stock";
import { errorResponse, fail, readOptionalBody } from "@/lib/news/http";

/**
 * Запас историй ПК со страницы «Новости»: { reject: id } — «Не то» у истории (она пропадает из списка, ПК её больше не
 * предлагает и учится на отказе); { drop: id } — «Убрать»: пропадает так же, но без выводов о вкусе; { more: true } —
 * «Найти ещё»: ПК ищет, как только освободится. В ответ — запас.
 */
export async function POST(req: NextRequest) {
  const body = await readOptionalBody(req);
  if (body instanceof NextResponse) return body;
  if (body.reject === undefined && body.drop === undefined && body.more !== true) return fail("Нужно { reject: id }, { drop: id } или { more: true }", 400);
  try {
    if (body.reject !== undefined) await removePick(body.reject, true);
    if (body.drop !== undefined) await removePick(body.drop, false);
    if (body.more === true) await askMore();
    return NextResponse.json({ stock: stockView() });
  } catch (e) {
    return errorResponse(e);
  }
}
