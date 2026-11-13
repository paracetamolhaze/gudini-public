import { NextResponse } from "next/server";
import { listAccounts } from "@/lib/trends/accounts";
import { igTrendsRequest } from "@/lib/trends/client";
import { runSummary } from "@/lib/trends/rank";
import { readMade, readTrendsState } from "@/lib/trends/state";
import { THEMES } from "@/lib/trends/types";

export const runtime = "nodejs";
// данные читаются с диска на каждый запрос: статическая сборка запекла бы пустой раздел
export const dynamic = "force-dynamic";

/** Всё для страницы «Тренды»: аккаунты, карточки, последний прогон каждой темы и состояние браузера. */
export async function GET() {
  const state = readTrendsState();
  const made = readMade();
  const browser = await igTrendsRequest("status").then((s) => ({ available: true, ...s }), (e: Error) => ({ available: false, error: e.message }));
  const latest = Object.fromEntries(THEMES.map((theme) => {
    const run = state.runs.filter((r) => r.theme === theme).at(-1);
    if (!run) return [theme, null];
    const cards = run.cards.map((key) => state.cards.find((c) => c.key === key)).filter((c) => c !== undefined);
    return [theme, { ...run, summary: runSummary(run.reads, cards) }];
  }));
  return NextResponse.json(
    // расшифровка нужна только Claude: страница её не показывает, а опрос идёт каждые 3 секунды
    { accounts: listAccounts(), cards: state.cards.map(({ transcript: _, ...c }) => ({ ...c, made: made[c.key] ?? [] })), latest, browser },
    { headers: { "Cache-Control": "no-store" } },
  );
}
