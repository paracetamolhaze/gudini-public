import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects, runnerSeenAt, trackViews } from "@/lib/news/store";
import { choosePick, stockView } from "@/lib/news/stock";
import { runnerQuiet, toSummary } from "@/lib/news/rules";
import { listMarks } from "@/lib/news/publish";
import { errorResponse, readOptionalBody } from "@/lib/news/http";

// список читается с диска на каждый запрос: статическая сборка запекла бы пустой
export const dynamic = "force-dynamic";

/**
 * Все ролики «Новостей», свежие сверху: с обложкой и тем, куда ролик опубликован; музыка с ПК; runner — когда
 * исполнитель последний раз спрашивал работу (seenAt, null — с перезапуска сайта не спрашивал) и не простаивает ли
 * очередь без него (quiet: задача давно ждёт, а ПК молчит); stock — истории на выбор из запаса ПК (lib/news/stock.ts).
 */
export async function GET() {
  const at = Date.now();
  const projects = listProjects();
  const marks = listMarks(projects);
  const seenAt = runnerSeenAt();
  return NextResponse.json({
    projects: projects.map((p) => toSummary(p, at, marks.get(p.id))),
    tracks: trackViews(),
    stock: stockView(),
    runner: { seenAt, quiet: runnerQuiet(projects.map((p) => p.job), seenAt, at) },
  });
}

/**
 * «Создать»: новый ролик без полей — исполнитель на ПК возьмёт лучшую историю из запаса и смонтирует. { pick } —
 * «Монтировать» у истории из запаса: ролик будет именно по ней. Ещё одно нажатие — ещё один ролик в очередь.
 */
export async function POST(req: NextRequest) {
  const body = await readOptionalBody(req);
  if (body instanceof NextResponse) return body;
  try {
    const project = await createProject(body.pick === undefined ? undefined : choosePick(body.pick));
    return NextResponse.json({ id: project.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
