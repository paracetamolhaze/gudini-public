import { NextRequest, NextResponse } from "next/server";
import { createAutoProject, createProject, listProjects } from "@/lib/studio3d/store";
import { toSummary } from "@/lib/studio3d/rules";
import { listMarks } from "@/lib/studio3d/publish";
import { errorResponse, readBody } from "@/lib/studio3d/http";

// список читается с диска на каждый запрос: статическая сборка запекла бы пустой
export const dynamic = "force-dynamic";

/** Список скетчей «3Д», свежие сверху: с обложкой и тем, куда ролик опубликован. */
export async function GET() {
  const at = Date.now();
  const projects = listProjects();
  const marks = listMarks(projects);
  return NextResponse.json({ projects: projects.map((p) => toSummary(p, at, marks.get(p.id))) });
}

/**
 * Новый скетч: сразу ставится задача написать сценарий. { auto: true } — кнопка «Создать видео»: идею исполнитель
 * находит сам, после сценария сразу идёт монтаж.
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  try {
    const project = body.auto === true ? await createAutoProject() : await createProject(body.topic, body.notes);
    return NextResponse.json({ id: project.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
