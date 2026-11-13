import { NextRequest, NextResponse } from "next/server";
import { createProject as createVideoProject, updateProject } from "@/lib/store";
import { createProject as create3D } from "@/lib/studio3d/store";
import { AccountError, changeAccounts, runAccounts } from "@/lib/trends/accounts";
import { igTrendsRequest } from "@/lib/trends/client";
import { addMade, isCardKey, readTrendsState } from "@/lib/trends/state";
import { THEMES, type Theme } from "@/lib/trends/types";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ action: string }> };

/** Действия, которые сайт передаёт контейнеру как есть: вход в Instagram, остановка, разбор, другой вариант, скрыть карточку. */
const PROXY = ["login", "input", "finish", "close", "disconnect", "stop", "analyze", "rewrite", "hide"];

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const ok = (data: unknown) => NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { action } = await params;
  if (!["status", "frame"].includes(action)) return fail("Not found", 404);
  return igTrendsRequest(action).then(ok, (e: Error) => fail(e.message, 503));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return fail("Invalid origin", 403);
  if (Number(req.headers.get("content-length") || 0) > 16_384) return fail("Too large", 413);
  const { action } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    if (PROXY.includes(action)) return ok(await igTrendsRequest(action, body));
    if (action === "accounts") return ok({ accounts: changeAccounts(body) });
    if (action === "run") {
      if (!THEMES.includes(body?.theme)) return fail("Неизвестная тема");
      const accounts = runAccounts(body.theme as Theme);
      if (!accounts.length) return fail("В этой теме нет утверждённых аккаунтов: оставьте предложенные или добавьте свои.");
      return ok(await igTrendsRequest("run", { theme: body.theme, accounts }));
    }
    if (action === "make") return ok(await make(body));
    return fail("Not found", 404);
  } catch (e) {
    if (e instanceof AccountError) return fail(e.message);
    const status = (e as { status?: unknown })?.status;
    return fail(e instanceof Error ? e.message : "Ошибка трендов", typeof status === "number" ? status : 503);
  }
}

/** «Сделать в 3Д» и «Сделать ролик»: проект с темой и сценарием из карточки, ссылка на него остаётся у карточки. */
async function make(body: any) {
  if (!isCardKey(body?.key)) throw Object.assign(new Error("Карточка не найдена"), { status: 404 });
  const card = readTrendsState().cards.find((c) => c.key === body.key);
  const idea = card?.idea;
  if (!card || !idea) throw Object.assign(new Error("У карточки ещё нет нашего варианта"), { status: 409 });
  const at = new Date().toISOString();
  if (idea.kind === "sketch") {
    // у новой формы нет имени из списка — говорим, как она устроена
    const formula = card.analysis?.formulaId ? `по формуле «${card.analysis.formulaName}»` : card.analysis?.shape ? `по форме источника (${card.analysis.shape})` : "по форме источника";
    const notes = [`Первая реплика ${formula}: ${idea.opening}`, `Формула взята у ролика: ${card.url}`].join("\n").slice(0, 1000);
    const project = await create3D(idea.plot, notes);
    addMade(card.key, { kind: "3d", projectId: project.id, at });
    return { kind: "3d", projectId: project.id, href: `/3d/${project.id}` };
  }
  const project = createVideoProject((idea.topic || idea.title).trim());
  updateProject(project.id, { script: idea.script, scriptDemo: false });
  addMade(card.key, { kind: "video", projectId: project.id, at });
  return { kind: "video", projectId: project.id, href: `/project/${project.id}` };
}
