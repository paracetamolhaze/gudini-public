import fs from "fs";
import path from "path";
import { DEFAULT_CAPTION_STYLE, type EditPlan } from "../editPlan";
import type { PreparedLibrary } from "../montageV3Pipeline";
import { prepareLibrary } from "../montageV3Pipeline";
import type { StoryResearchPack } from "../storyResearch";
import type { Word } from "../transcribe";
import { planCards, type CardsPlan } from "./plan";

/**
 * Стадия «режиссёр» монтажа «С картинками»: медиатека истории (её собирают параллельно с чисткой речи)
 * и раскадровка по фразам. План для остального конвейера — кадры с картинками как перебивки:
 * по ним считаются «перебивок N» и точки проверки чёрных кадров.
 */
export async function directCards(args: {
  research: StoryResearchPack;
  script: string;
  words: Word[];
  duration: number;
  dir: string;
  prepared?: PreparedLibrary;
  onProgress?: (message: string) => void;
}): Promise<{ plan: EditPlan; cards: CardsPlan }> {
  const library = args.prepared ?? (await prepareLibrary(args.research, args.script, args.dir, args.onProgress));
  const cards = await planCards({ research: args.research, beats: library.beats, pack: library.pack, words: args.words, duration: args.duration, dir: args.dir });
  const pictures = cards.shots.filter(s => s.layout !== "author");
  console.log(
    `Картинки: медиатека ${library.pack.assets.length}${library.packReused ? " (переиспользована)" : ""}, раскадровка ${cards.source === "model" ? "монтажёра" : "по медиатеке"}: ` +
      `кадров ${cards.shots.length}, с картинкой ${pictures.length} (фото ${pictures.filter(s => s.file).length}, сцен ${pictures.filter(s => s.scene).length}, ` +
      `из Википедии ${pictures.filter(s => s.real).length}, на весь экран ${pictures.filter(s => s.layout === "full").length})`,
  );
  for (const note of cards.notes) console.log(`  раскадровка: ${note}`);
  const plan: EditPlan = {
    version: 1,
    duration: args.duration,
    events: pictures.map(s => ({
      type: "B_ROLL" as const,
      layout: s.layout === "full" ? ("fullscreen" as const) : ("top_inset" as const),
      start: s.from,
      end: s.to,
      ...(s.file ? { file: s.file } : {}),
      eventName: (s.scene ?? s.real?.wiki ?? s.real?.query ?? path.basename(s.file ?? "")).slice(0, 80),
    })),
    captionStyle: { ...DEFAULT_CAPTION_STYLE },
  };
  fs.writeFileSync(path.join(args.dir, "edit-plan.json"), JSON.stringify(plan, null, 2), "utf8");
  return { plan, cards };
}
