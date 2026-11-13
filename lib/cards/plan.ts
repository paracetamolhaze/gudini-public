import fs from "fs";
import path from "path";
import sharp from "sharp";
import { mediaVision, parseJson, type VisionImage } from "../mediaLlm";
import { textHash } from "../fileFingerprint";
import type { Word } from "../transcribe";
import type { PunctWord } from "../scriptPunctuation";
import type { StoryResearchPack } from "../storyResearch";
import type { ScriptBeat } from "../scriptBeats";
import type { StoryAssetPackV2, PackAsset } from "../storyAssetPack";

/**
 * Раскадровка монтажа «С картинками».
 *
 * Речь режется на короткие фразы (1–3 с), монтажёр видит сами картинки медиатеки и ставит на каждую
 * фразу кадр: фото истории, настоящее фото известного (Википедия) или сцену, которую дорисует генератор.
 * Таймкоды ставит код по словам, модели доверяется только выбор кадра по номерам фраз.
 * Раскадровка никогда не роняет монтаж: без ответа модели кадры расставляются по медиатеке сами.
 */

export const CARDS_PLAN_VERSION = 3;

/** Each scene is about a minute and a half of the image generator (three at a time); past this the library stands in. */
export const MAX_SCENES = 10;

export type Phrase = { id: number; from: number; to: number; text: string; firstWord: number; lastWord: number };

export type CardsShot = {
  from: number;
  to: number;
  layout: "split" | "full" | "author";
  file?: string;
  scene?: string;
  real?: { query: string; wiki?: string };
  backup?: string;
  accent?: boolean;
};

export type CardsPlan = { shots: CardsShot[]; emphasis: number[]; phrases: Phrase[]; source: "model" | "library"; notes: string[] };

const SENTENCE_END = /[.!?…]["»”]?$/;

/**
 * Фразы для раскадровки: конец предложения, запятая в длинной фразе, пауза в речи; фраза длиннее 3.2 с
 * делится на ближайшей паузе. Короче 0.9 с фраза прилипает к следующей.
 */
export function splitPhrases(words: Word[]): Phrase[] {
  const out: Phrase[] = [];
  let first = 0;
  const close = (last: number) => {
    out.push({
      id: out.length + 1, from: words[first].start, to: words[last].end, firstWord: first, lastWord: last,
      text: words.slice(first, last + 1).map(w => w.word).join(" "),
    });
    first = last + 1;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as PunctWord;
    const next = words[i + 1];
    const length = w.end - words[first].start;
    const pause = next ? next.start - w.end : Infinity;
    const sentence = w.sentenceEnd || w.paragraphEnd || SENTENCE_END.test(w.word);
    const comma = w.punct === "," || w.punct === ";" || w.punct === ":" || /[,;:—]$/.test(w.word);
    if (!next) close(i);
    else if (length < 0.9) continue;
    else if (sentence || pause > 0.35 || (comma && length > 1.6)) close(i);
    else if (length + (next.end - next.start) > 3.2) close(i);
  }
  // A short tail phrase joins the one before it.
  const last = out[out.length - 1];
  if (out.length > 1 && last.to - last.from < 0.9) {
    const prev = out[out.length - 2];
    out.splice(out.length - 2, 2, { ...prev, to: last.to, lastWord: last.lastWord, text: `${prev.text} ${last.text}` });
  }
  return out;
}

/** Слова, которые в субтитрах крупнее: имена, названия и числа, отмеченные по сценарию, и любые цифры. */
export function captionEmphasis(words: Word[]): number[] {
  return words.flatMap((w, i) => ((w as PunctWord).emphasis || /\d/.test(w.word) ? [i] : []));
}

/** Фото с одним и тем же видимым содержанием (одно событие с разных ракурсов, копии одного снимка). */
type Shown = { n: number; asset: PackAsset; aspect: number; family: string };
const familyOf = (asset: PackAsset) => asset.visualFamily ?? asset.id;

/**
 * Сколько раз за ролик может появиться семейство фото, которым закрывают дыры: выбранное монтажёром — на раз больше
 * (он уже поставил его по смыслу), не выбранное им ни разу — только когда он не выбрал ни одного фото.
 */
const MAX_FAMILY_STAND_INS = 2;

const SYSTEM = `Ты — монтажёр коротких вертикальных роликов для TikTok и Reels. Автор рассказывает историю в камеру,
ты ставишь на его слова картинки так, чтобы зритель видел то, о чём он говорит в эту секунду.

Экран бывает трёх видов:
- split — картинка в верхней половине экрана (почти квадрат, 1080×930), автор под ней во всю ширину, субтитр на линии между ними. Основной вид: на нём хорошо стоят и горизонтальные фото, и квадратные.
- full — одна вертикальная картинка на весь экран, без автора и без субтитров. Это удар: самый сильный момент истории, появление главного героя или предмета, развязка. Хорошо работают 2–4 таких кадра за ролик, каждый 1.5–3 с.
- author — только автор крупно: его собственная мысль, оценка, вопрос зрителю, финальная фраза. Коротко, 1.5–3 с.

Хороший монтаж:
- Первая же фраза стоит на картинке, которая цепляет: главный предмет или самый яркий момент истории. Ролик начинается с картинки.
- Картинка меняется, когда в речи появляется новый участник, предмет, место, действие или последствие — обычно каждые 2–3 секунды, держится не дольше 4 секунд. Если одна мысль тянется дольше, покажи её с другой стороны: деталь, участника, место, результат.
- Каждый кадр показывает именно то, что звучит под ним. Пример из ролика про роботакси Waymo: «подростки взяли игрушечный пистолет с гидрогелевыми шариками» — фото гель-бластера и шариков; «за салоном через камеры следил искусственный интеллект» — сцена: камера под потолком салона смотрит на задние сиденья; «машина свернула на парковку, а там уже ждала полиция» — сцена с полицейскими машинами вокруг белого Waymo на парковке.
- Картинка иллюстрирует слова автора, а факты делают её точной: марка и цвет машины, место, время суток, сколько людей и что у них в руках. Если источники рассказывают о моменте иначе, чем автор, выбирай кадр, который подходит к его словам и не спорит с ними: камера салона, машина, место действия.
- Фото из медиатеки — настоящие фото этой истории, они идут первыми. Одно фото можно показать дважды, если рассказ к нему возвращается, но не подряд.
- Известного человека, компанию, город или вещь, у которых есть статья в Википедии, можно показать настоящим фото оттуда: {"real": {"wiki": "Waymo", "query": "Waymo self-driving car"}}.
- Когда ни одно фото не показывает момент, его рисует генератор фотореалистичных картинок: опиши сцену по-английски как кадр новостного фото — кто в кадре и сколько их, что у них в руках, что они делают, где и когда, с фактами истории. Несовершеннолетних генератор показывает со спины, в профиль или издалека — так и пиши. Для full сцена рисуется вертикальной, для split — квадратной.
- Генератор успевает нарисовать до ${MAX_SCENES} сцен на ролик: отдай их моментам, которые нечем показать из медиатеки, а фото медиатеки используй везде, где они подходят.
- Субтитры уже показывают слова автора, поэтому текст на картинках не нужен: показывай предметы, людей, места и действия.

Формат ответа — только JSON:
{"shots":[
  {"phrases":[1,2],"layout":"full","scene":"A white Waymo self-driving taxi at night in a parking lot, surrounded by three police cars with flashing lights, officers standing around it","accent":true},
  {"phrases":[3],"layout":"split","photo":2},
  {"phrases":[4,5],"layout":"split","scene":"..."},
  {"phrases":[6],"layout":"author"}
]}
phrases — номера фраз подряд, которые закрывает кадр; все фразы по порядку, каждая ровно в одном кадре.
photo — номер картинки медиатеки из списка. accent — true для 3–6 самых сильных поворотов истории: картинка придёт со вспышкой и ударом.`;

/**
 * Картинки медиатеки, которые увидит монтажёр: до 24, лучшие по совпадению с блоками сценария, не больше двух
 * из одного семейства — четыре почти одинаковых фото ведра с шариками в Waymo превратились в четыре повтора подряд.
 */
async function showLibrary(pack: StoryAssetPackV2, mediaDir: string): Promise<{ shown: Shown[]; images: VisionImage[] }> {
  const best = (a: PackAsset) => Math.max(0, ...Object.values(a.beatScores ?? {}));
  const perFamily = new Map<string, number>();
  const candidates = pack.assets.filter(a => a.kind === "IMAGE" && fs.existsSync(path.join(mediaDir, a.file)))
    .sort((a, b) => best(b) - best(a))
    .filter(a => {
      const family = familyOf(a);
      perFamily.set(family, (perFamily.get(family) ?? 0) + 1);
      return perFamily.get(family)! <= 2;
    })
    .slice(0, 24);
  const shown: Shown[] = [];
  const images: VisionImage[] = [];
  for (const asset of candidates) {
    try {
      const file = path.join(mediaDir, asset.file);
      const meta = await sharp(file).metadata();
      const buffer = await sharp(file).rotate().resize(448, 448, { fit: "inside" }).jpeg({ quality: 78 }).toBuffer();
      const swap = (meta.orientation ?? 1) >= 5;
      const aspect = meta.width && meta.height ? (swap ? meta.height / meta.width : meta.width / meta.height) : 1.5;
      shown.push({ n: shown.length + 1, asset, aspect, family: familyOf(asset) });
      images.push({ base64: buffer.toString("base64"), mediaType: "image/jpeg" });
    } catch { /* a broken file is simply not offered */ }
  }
  return { shown, images };
}

function userPrompt(research: StoryResearchPack, phrases: Phrase[], shown: Shown[], duration: number): string {
  const facts = research.facts.slice(0, 18).map(f => `- ${f.text}`).join("\n");
  return [
    `Тема: ${research.topic}`,
    `Событие: ${research.canonicalEvent}${research.location ? `, ${research.location}` : ""}${research.eventDate ? `, ${research.eventDate}` : ""}`,
    facts ? `Проверенные факты:\n${facts}` : "",
    "",
    `Речь автора по фразам (секунды ролика, всего ${duration.toFixed(1)} с):`,
    ...phrases.map(p => `${p.id}. [${p.from.toFixed(1)}–${p.to.toFixed(1)}] ${p.text}`),
    "",
    `Медиатека: к заданию приложены ${shown.length} картинок по порядку.`,
    ...shown.map(s => `${s.n}. ${s.aspect > 1.15 ? "горизонтальная" : s.aspect < 0.85 ? "вертикальная" : "квадратная"}; ${s.asset.description}${s.asset.sourceTitle ? ` (страница: ${s.asset.sourceTitle.slice(0, 90)})` : ""}`),
    "",
    "Составь раскадровку всего ролика.",
  ].filter(line => line !== undefined).join("\n");
}

type RawShot = { phrases?: number[]; layout?: string; photo?: number; scene?: string; real?: { wiki?: string; query?: string }; accent?: boolean };

/**
 * Ответ модели → кадры: фразы по порядку и без дыр, неизвестное отбрасывается, широкое фото на весь экран
 * уходит в верхнюю панель, лишние сцены заменяются фото медиатеки. Первая фраза всегда на картинке.
 */
export function shotsFromAnswer(raw: RawShot[], phrases: Phrase[], shown: Shown[], mediaDir: string, duration: number): { shots: CardsShot[]; notes: string[] } {
  const notes: string[] = [];
  const byN = new Map(shown.map(s => [s.n, s]));
  const owner = new Array<number>(phrases.length).fill(-1);
  const kept: { raw: RawShot; first: number; last: number }[] = [];
  for (const r of raw) {
    const ids = (r.phrases ?? []).filter(n => Number.isInteger(n) && n >= 1 && n <= phrases.length).sort((a, b) => a - b);
    if (!ids.length) continue;
    const first = ids[0] - 1, last = ids[ids.length - 1] - 1;
    if (owner.slice(first, last + 1).some(o => o >= 0)) { notes.push(`кадр на фразах ${ids.join(",")} пересёкся с прошлым — пропущен`); continue; }
    for (let i = first; i <= last; i++) owner[i] = kept.length;
    kept.push({ raw: r, first, last });
  }
  kept.sort((a, b) => a.first - b.first);
  // Phrases nobody took go to the shot before them (or after, at the start).
  for (let i = 0; i < phrases.length; i++) {
    if (owner[i] >= 0) continue;
    const before = kept.filter(k => k.last < i).pop();
    const after = kept.find(k => k.first > i);
    if (before) before.last = Math.max(before.last, i);
    else if (after) after.first = Math.min(after.first, i);
  }
  const photoFile = (n?: number) => (n && byN.has(n) ? path.join(mediaDir, byN.get(n)!.asset.file) : undefined);
  const libraryFiles = shown.map(s => path.join(mediaDir, s.asset.file));
  const family = new Map(shown.map(s => [path.join(mediaDir, s.asset.file), s.family]));
  const uses = new Map<string, number>();
  const use = (file: string) => uses.set(family.get(file)!, (uses.get(family.get(file)!) ?? 0) + 1);
  for (const k of kept) { const f = photoFile(k.raw.photo); if (f) use(f); }
  // Stand-ins come from the photos the editor picked somewhere in the video: those are on topic. The ones it passed over
  // (in Waymo: pistols from a gun shop, a bottle on a desk) came back as stand-ins and were the worst shots of the video.
  const picked = new Set([...uses.keys()]);
  const pool = picked.size ? libraryFiles.filter(f => picked.has(family.get(f)!)) : libraryFiles;
  const poolLimit = picked.size ? MAX_FAMILY_STAND_INS + 1 : MAX_FAMILY_STAND_INS;
  // A stand-in photo: the least shown family of the pool, not the one just before, and not one shown too often already.
  const standIn = (previous: string | undefined, limit = poolLimit) => [...pool]
    .filter(f => family.get(f) !== (previous && family.get(previous)) && (uses.get(family.get(f)!) ?? 0) < limit)
    .sort((a, b) => (uses.get(family.get(a)!) ?? 0) - (uses.get(family.get(b)!) ?? 0))[0];
  let scenes = 0;
  // One Wikipedia article gives one photo: asked again, it would be the same picture again.
  const reals = new Set<string>();
  const realKey = (r: NonNullable<RawShot["real"]>) => String(r.wiki ?? r.query ?? "").trim().toLowerCase();
  const shots: CardsShot[] = [];
  kept.forEach((k, index) => {
    const from = index === 0 ? 0 : phrases[k.first].from;
    const to = phrases[k.last].to;
    let layout: CardsShot["layout"] = k.raw.layout === "full" || k.raw.layout === "author" ? k.raw.layout : "split";
    const shot: CardsShot = { from, to, layout, ...(k.raw.accent ? { accent: true } : {}) };
    const photo = photoFile(k.raw.photo);
    const before = shots[shots.length - 1];
    const previous = before?.file;
    const scene = typeof k.raw.scene === "string" && k.raw.scene.trim().length > 12 ? k.raw.scene.trim() : undefined;
    // Nothing new to show: the picture before holds a little longer, or the author takes the moment.
    const holdOrAuthor = (why: string) => {
      notes.push(`фразы ${k.first + 1}–${k.last + 1}: ${why}`);
      if (before && before.layout !== "author" && to - before.from <= 5) { before.to = to; return true; }
      shot.layout = layout = "author";
      return false;
    };
    if (layout !== "author") {
      if (photo && previous && family.get(photo) === family.get(previous) && to - before!.from <= 5) {
        // The same view twice in a row is one longer shot.
        before!.to = to;
        return;
      }
      if (photo) {
        shot.file = photo;
        // A wide photo on the whole screen would be cut to a strip: it stands in the upper panel instead.
        if (layout === "full" && (byN.get(k.raw.photo!)?.aspect ?? 1) > 0.85) shot.layout = layout = "split";
      } else if (scene && scenes < MAX_SCENES) {
        shot.scene = scene;
        scenes++;
      } else if (k.raw.real && realKey(k.raw.real) && !reals.has(realKey(k.raw.real))) {
        reals.add(realKey(k.raw.real));
        shot.real = { query: String(k.raw.real.query ?? k.raw.real.wiki), ...(k.raw.real.wiki ? { wiki: String(k.raw.real.wiki) } : {}) };
      } else {
        const stand = standIn(previous);
        if (stand) {
          notes.push(`фразы ${k.first + 1}–${k.last + 1}: ${scene ? "сцен уже много" : "кадр без картинки"} — фото медиатеки`);
          shot.file = stand;
          use(stand);
          if (layout === "full") shot.layout = layout = "split";
        } else if (holdOrAuthor(scene ? "сцен уже много, медиатека показана" : "кадр без картинки")) return;
      }
      // The backup stands in only if the scene fails, so it is not counted as shown.
      if (!shot.file && libraryFiles.length) shot.backup = standIn(previous, Infinity) ?? libraryFiles[0];
    }
    shots.push(shot);
  });
  // The video opens on a picture: an opening author shot takes the first library photo (or the scene of the next shot).
  if (shots.length && shots[0].layout === "author") {
    const opener = libraryFiles[0];
    if (opener) Object.assign(shots[0], { layout: "split", file: opener });
  }
  if (shots.length) shots[shots.length - 1].to = Math.max(shots[shots.length - 1].to, duration);
  return { shots, notes };
}

/**
 * Без ответа модели: фото медиатеки по порядку блоков сценария, каждое на одну-две фразы (2–3.5 с),
 * каждое не больше двух раз. Монтаж выходит проще, но выходит.
 */
export function libraryShots(phrases: Phrase[], pack: StoryAssetPackV2, beats: ScriptBeat[], mediaDir: string, duration: number): CardsShot[] {
  const order = new Map(beats.map((b, i) => [b.id, i]));
  const firstBeat = (a: PackAsset) => Math.min(...a.compatibleBeatIds.map(id => order.get(id) ?? 99), 99);
  const files = pack.assets.filter(a => a.kind === "IMAGE" && fs.existsSync(path.join(mediaDir, a.file)))
    .sort((a, b) => firstBeat(a) - firstBeat(b)).map(a => path.join(mediaDir, a.file));
  if (!files.length) return [{ from: 0, to: duration, layout: "author" }];
  const shots: CardsShot[] = [];
  let i = 0;
  while (i < phrases.length) {
    let j = i;
    while (j + 1 < phrases.length && phrases[j + 1].to - phrases[i].from <= 3.5 && phrases[j].to - phrases[i].from < 2) j++;
    // The pictures go in story order; once all are shown the order starts again.
    const file = files[shots.length % files.length];
    shots.push({ from: i === 0 ? 0 : phrases[i].from, to: phrases[j].to, layout: "split", file });
    i = j + 1;
  }
  shots[shots.length - 1].to = Math.max(shots[shots.length - 1].to, duration);
  return shots;
}

const PLAN_FILE = "cards-plan.json";

/** Раскадровка ролика: по ответу монтажёра, сохранённая для того же текста и медиатеки, или по медиатеке без модели. */
export async function planCards(args: {
  research: StoryResearchPack;
  beats: ScriptBeat[];
  pack: StoryAssetPackV2;
  words: Word[];
  duration: number;
  dir: string;
  log?: (line: string) => void;
}): Promise<CardsPlan> {
  const { research, beats, pack, words, duration, dir } = args;
  const log = args.log ?? console.log;
  const mediaDir = path.join(dir, "story-assets");
  const phrases = splitPhrases(words);
  const emphasis = captionEmphasis(words);
  const { shown, images } = await showLibrary(pack, mediaDir);
  const key = textHash(JSON.stringify([CARDS_PLAN_VERSION, phrases.map(p => [p.text, Math.round(p.from * 10)]), shown.map(s => s.asset.id), research.facts.map(f => f.id)]));
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dir, PLAN_FILE), "utf8"));
    if (saved?.key === key && Array.isArray(saved.raw)) {
      const { shots, notes } = shotsFromAnswer(saved.raw, phrases, shown, mediaDir, duration);
      log(`Раскадровка переиспользована: кадров ${shots.length}`);
      return { shots, emphasis, phrases, source: "model", notes };
    }
  } catch { /* no saved plan */ }
  if (images.length) {
    try {
      const answer = await mediaVision({ system: SYSTEM, user: userPrompt(research, phrases, shown, duration), images, stage: "Creative Director", maxTokens: 8000 });
      const raw = parseJson<{ shots?: RawShot[] }>(answer, "Раскадровка картинок").shots ?? [];
      const { shots, notes } = shotsFromAnswer(raw, phrases, shown, mediaDir, duration);
      if (shots.length >= Math.min(3, phrases.length)) {
        fs.writeFileSync(path.join(dir, PLAN_FILE), JSON.stringify({ key, createdAt: new Date().toISOString(), raw, phrases }, null, 2), "utf8");
        return { shots, emphasis, phrases, source: "model", notes };
      }
      log(`Раскадровка: в ответе ${raw.length} кадров — ставлю кадры по медиатеке`);
    } catch (error) {
      log(`Раскадровка не получилась (${String((error as Error)?.message ?? error).slice(0, 200)}) — ставлю кадры по медиатеке`);
    }
  }
  return { shots: libraryShots(phrases, pack, beats, mediaDir, duration), emphasis, phrases, source: "library", notes: [] };
}
