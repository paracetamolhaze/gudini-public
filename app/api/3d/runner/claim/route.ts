import { NextResponse } from "next/server";
import { claimNext } from "@/lib/studio3d/store";
import type { ClaimResponse } from "@/lib/studio3d/types";
import { errorResponse } from "@/lib/studio3d/http";

/**
 * Исполнитель 3Д берёт самую старую задачу из очереди; { job: null } — делать нечего. К подсказкам, монтажу и
 * сборке с голосом владельца прилагается план озвучки (voice): ключи реплик и какие записи брать (для сборки —
 * и где каждая лежит на ролике).
 */
export async function POST() {
  try {
    const claimed = await claimNext();
    const res: ClaimResponse = claimed ?? { job: null };
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
