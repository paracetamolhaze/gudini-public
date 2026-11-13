import { NextRequest, NextResponse } from "next/server";
import { claimNext, markRunnerSeen, missingTracks, saveTracks } from "@/lib/news/store";
import { ordersForRunner, saveStock } from "@/lib/news/stock";
import type { ClaimResponse } from "@/lib/news/types";
import { errorResponse, readOptionalBody } from "@/lib/news/http";

/**
 * Исполнитель «Новостей» на ПК берёт самую старую задачу из очереди; { job: null } — делать нечего. В теле
 * { tracks } — музыка из его папки news/music: список сохраняется (только если изменился) и показывается на
 * странице ролика. Без tracks (или без тела) список остаётся прежним. needTracks — треки, чьих подготовленных
 * кусков на сайте ещё нет: исполнитель досылает их (PUT runner/track), после этого они играют и склеиваются сразу.
 * { stock } — его запас историй для выбора на странице «Новости» (lib/news/stock.ts); stockOrders — что владелец
 * с тех пор попросил: отклонённые истории и «Найти ещё».
 */
export async function POST(req: NextRequest) {
  const body = await readOptionalBody(req);
  if (body instanceof NextResponse) return body;
  try {
    markRunnerSeen();
    if (body.tracks !== undefined) await saveTracks(body.tracks);
    if (body.stock !== undefined) await saveStock(body.stock);
    const claimed = await claimNext();
    const needTracks = missingTracks();
    const stockOrders = ordersForRunner();
    const res: ClaimResponse = { ...(claimed ?? { job: null }), ...(needTracks.length ? { needTracks } : {}), ...(stockOrders ? { stockOrders } : {}) };
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
