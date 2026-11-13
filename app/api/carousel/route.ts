import { NextRequest } from "next/server";
import { fail, guard, ok } from "@/lib/carousel/http";
import { attachJob, deleteCarousel, listCarousels, updateCarousel } from "@/lib/carousel/store";
import { toSummary } from "@/lib/carousel/view";
import { ensureRunner } from "@/lib/carousel/runnerControl";
import { createSidCarousel } from "@/lib/carousel/sid/create";
import { sidConfigProblems } from "@/lib/carousel/sid/claude";
import { DEFAULT_STYLE, isStyleId, styleName } from "@/lib/carousel/styles/catalog";
import { isMemeCarousel } from "@/lib/carousel/meme";
import { memeCarouselStyles } from "@/lib/memes/assemble";

export const dynamic = "force-dynamic";

/** Список каруселей: обычные для вкладки «Карусель», ?section=memes — собранные из мемов для вкладки «Мемы». */
export async function GET(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const memes = req.nextUrl.searchParams.get("section") === "memes";
    let list = listCarousels().filter((c) => isMemeCarousel(c) === memes);
    // во вкладке «Мемы» у каждого стиля свои карусели
    const style = req.nextUrl.searchParams.get("style");
    if (memes && style) {
      const styles = memeCarouselStyles();
      list = list.filter((c) => (c.request.memeStyle ?? styles.get(c.id) ?? "lukashenko") === style);
    }
    return ok({ carousels: list.map(toSummary) });
  } catch (e) {
    return fail(e);
  }
}

/**
 * «Создать»: раздел делает карусель формата @siddhantt.ai целиком сам — тему, тексты, обложку, скриншоты,
 * слайды и ролик (lib/carousel/sid). Формы темы больше нет: карусель сохраняется сразу, работа идёт
 * фоновым заданием, а страница карусели показывает шаги.
 */
export async function POST(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const problems = sidConfigProblems();
    if (problems.length) return ok({ error: problems.join(" "), code: "config" }, 400);
    // стиль из кнопки «Создать»; без него — «Расследование», прежний формат раздела
    const body = (await req.json().catch(() => ({}))) as { style?: unknown };
    const style = isStyleId(body?.style) ? body.style : DEFAULT_STYLE;
    const created = createSidCarousel({ style });
    try {
      updateCarousel(created.id, (c) => {
        c.title = `Новая карусель: «${styleName(style)}»`;
        attachJob(c, "generate");
      });
    } catch (e) {
      // очередь полна — пустую карточку без задания не оставляем
      try {
        deleteCarousel(created.id);
      } catch {}
      throw e;
    }
    ensureRunner();
    return ok({ id: created.id }, 201);
  } catch (e) {
    return fail(e);
  }
}
