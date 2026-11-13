// Владелец в кадре (как дед в красной водолазке у @darvin.ya, только сам владелец): поднимается снизу по центру по пояс,
// будто сам говорит эти слова. Владелец 29.10: «без стрелки, снизу выходил вначале с фразой начальной», «зелёная заставка
// должна закончиться, потом выхожу я», «без указательной руки, без обрезанных плеч, желательно чтобы я выходил по пояс»,
// «вставлять меня не только в начало, а когда это уместно тоже». На зачине — всегда, остальное выбирает режиссёр (draft.owner).
// Claude отмечает героя на каждом плане, где владелец стоит, размер считает runner/py/peek_layout.py, готовые кадры Claude
// проверяет ещё раз; не сошлось — это появление без владельца, ролик выходит всё равно.
import fs from "node:fs";
import path from "node:path";
import type { NewsPlan, OwnerPeek } from "../../engine/src/plan";
import { claudeJson } from "./llm";
import type { Draft } from "./plan";
import { ffmpeg, mapLimit, MEDIA_ROOT, python, writeJson, type Hooks } from "./util";

const W = 1080;
const H = 1920;
const FPS = 30;
/** Сколько секунд владелец в кадре: на зачине и в середине ролика (там картинка меняется чаще). */
const OPENING_SECONDS = 2.2;
const LATER_SECONDS = 1.8;
/** Его картинка: по пояс, руки опущены, плечи целиком в кадре. */
const POSE = "waist.png";
/** Зелёная вспышка первой секунды: 33 кадра движка (engine/src/Main.tsx, FX_FRAMES). */
const BURST_SECONDS = 33 / FPS;

type Spot = { line: string; word: number; target: string };
type Layout = Pick<OwnerPeek, "side" | "flip" | "fig">;

const FIND_SYSTEM = "Ты смотришь на кадр вертикального ролика 1080×1920 и отмечаешь на нём то, что попросили. Ответ — только JSON.";
const CHECK_SYSTEM = "Ты проверяешь кадр вертикального ролика перед публикацией. Ответ — только JSON.";

/** Где на экране окажется точка кадра ролика: тот же наезд и сдвиг, что у плана в движке (engine/src/Main.tsx, Visual). */
function view(shot: { zoomFrom?: number; still?: string; focusY?: number }, elapsed: number, length: number) {
  const from = shot.zoomFrom ?? 1;
  const to = shot.zoomFrom ? 1 : shot.still ? 1.08 : 1.04;
  const p = Math.min(1, Math.round(elapsed * FPS) / Math.max(1, Math.round(length * FPS)));
  const s = from + (to - from) * (shot.zoomFrom ? 1 - Math.pow(1 - p, 3) : p);
  const fy = shot.focusY ?? H / 2;
  return { s, tx: (W - W * s) / 2, ty: Math.min(0, Math.max(H - H * s, fy - fy * s)) };
}

/** Одно появление: со слова spot, dur секунд; за это время план героя успевает смениться — проверяются все его планы. */
async function placeOne(dir: string, pub: string, plan: NewsPlan, spot: Spot, opening: boolean, figure: string, hooks: Hooks): Promise<OwnerPeek> {
  const seg = plan.segments.find((s) => "narr" in s && s.narr === spot.line);
  const line = plan.lines[spot.line];
  if (!seg || !("narr" in seg) || !line?.words[spot.word]) throw new Error(`слова ${spot.line}:${spot.word} нет в голосе автора`);
  if (opening && seg !== plan.segments[0]) throw new Error("pointer не на зацепке");
  const words = line.words;
  const dur = opening ? OPENING_SECONDS : LATER_SECONDS;
  // на зачине — не раньше конца зелёной вспышки (как в движке)
  const appear = opening ? Math.max(BURST_SECONDS, words[spot.word].s) : words[spot.word].s;
  const until = Math.min(appear + dur, line.end + 0.12);
  fs.mkdirSync(dir, { recursive: true });
  const shots: { frame: string; view: [number, number, number]; box: number[] | null; body: number[] | null }[] = [];
  for (const [k, shot] of seg.shots.entries()) {
    // время плана внутри куска — как в движке: смена на слове минус 0,05 с
    const start = shot.w === 0 ? 0 : words[shot.w].s - 0.05;
    const next = k + 1 < seg.shots.length ? words[seg.shots[k + 1].w].s - 0.05 : line.end + 0.12;
    const from = Math.max(start, appear);
    const to = Math.min(next, until);
    if (to - from < 0.15) continue;
    if (!shot.clip || shot.still || shot.phone) {
      if (!shots.length) throw new Error("когда он появляется, в кадре не ролик героя");
      continue;
    }
    const length = next - start;
    const at = shot.endAt !== undefined ? Math.max(0, shot.endAt - length) : shot.maxAt !== undefined ? Math.max(0, Math.min(shot.at ?? 0, shot.maxAt - length)) : (shot.at ?? 0);
    // кадр — чуть после его появления на первом плане и середина следующих
    const elapsed = Math.min(length - 0.05, (shots.length ? (from + to) / 2 : from + 0.4) - start);
    const frame = path.join(dir, `frame${k}.jpg`);
    await ffmpeg(["-ss", (at + elapsed).toFixed(3), "-i", path.join(pub, plan.clips[shot.clip].file), "-frames:v", "1", "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, "-q:v", "3", frame], hooks.signal);
    const image = { base64: fs.readFileSync(frame).toString("base64"), mediaType: "image/jpeg" };
    const found = await claudeJson<{ box: [number, number, number, number] | null; body?: [number, number, number, number] | null }>(FIND_SYSTEM, `Найди: «${spot.target}» (или главного человека на кадре, если это другой план того же героя). box — рамка головы целиком, с волосами и причёской (если это предмет — рамка предмета); body — рамка всего человека целиком, с руками (для предмета — та же, что box). Ответ: {"box":[x,y,w,h],"body":[x,y,w,h]} в пикселях этого кадра (x, y — левый верхний угол). Если людей и этого предмета на кадре нет — {"box":null}.`, { images: [image], task: "news-peek-find", effort: "low" });
    const v = view(shot, elapsed, length);
    const onScreen = (b?: number[] | null) => (b?.length === 4 && b.every((n) => Number.isFinite(n)) ? [v.tx + b[0] * v.s, v.ty + b[1] * v.s, b[2] * v.s, b[3] * v.s].map((n) => Math.round(n)) : null);
    const box = onScreen(found.box);
    if (!box && !shots.length) throw new Error(`на кадре не нашлось «${spot.target}»`);
    shots.push({ frame, view: [v.s, v.tx, v.ty], box, body: onScreen(found.body) ?? box });
    hooks.log(`план ${k}: голова ${box?.join(",") ?? "нет"}, весь ${(onScreen(found.body) ?? box)?.join(",") ?? "нет"} на экране (наезд ${v.s.toFixed(2)})`);
  }
  if (!shots.length) throw new Error("когда он появляется, в кадре не ролик героя");
  const preview = path.join(dir, "preview.jpg");
  writeJson(path.join(dir, "shots.json"), shots);
  const out = JSON.parse(await python("peek_layout.py", [figure, path.join(dir, "shots.json"), preview], hooks.signal)) as { layout: Layout | null };
  if (!out.layout) throw new Error("снизу по центру он закрыл бы лицо героя");
  const many = shots.length > 1 ? `Это ${shots.length} плана подряд, он стоит на всех. ` : "";
  const check = await claudeJson<{ ok: boolean; why?: string }>(CHECK_SYSTEM, `${many}Снизу по центру кадра поднимается по пояс парень в полосатой джерси. Он не должен закрывать лицо героя («${spot.target}») и то главное, что происходит на кадре, а сам должен выглядеть цельно: без обрезанных плеч, рук и пальцев внутри кадра. Надписи и субтитры самого ролика закрывать можно — поверх идут свои русские субтитры. Так ли это? Ответ: {"ok":true} или {"ok":false,"why":"что не так"}.`, { images: [{ base64: fs.readFileSync(preview).toString("base64"), mediaType: "image/jpeg" }], task: "news-peek-check", effort: "low" });
  if (!check.ok) throw new Error(`проверка кадра: ${check.why ?? "закрывает героя"}`);
  return { line: spot.line, w: spot.word, dur, file: `peek/${POSE}`, ...out.layout };
}

/** Все появления владельца: зачин (pointer, со слова 0) и места, которые выбрал режиссёр (more). */
/**
 * openingWords — запасные слова зачина (начала его следующих планов): если на первом плане владельцу некуда встать,
 * не закрыв героя, он выходит на следующем плане зачина (29.10: на крупном первом плане лицо низко — и зачин
 * Литвинкова и сборного о шоу вышел без владельца).
 */
export async function placePeeks(workDir: string, pub: string, plan: NewsPlan, pointer: Draft["pointer"], more: Draft["owner"], hooks: Hooks, openingWords: number[] = []): Promise<void> {
  delete plan.peek;
  delete plan.peeks;
  const figure = path.join(MEDIA_ROOT, "peek", POSE);
  if (!fs.existsSync(figure)) return;
  const spots: [Spot[], boolean][] = [
    ...(pointer ? [[[0, ...openingWords].map((word) => ({ ...pointer, word })), true] as [Spot[], boolean]] : []),
    ...(more ?? []).map((s) => [[s], false] as [Spot[], boolean]),
  ];
  // появления независимы — проверяются разом; запасные слова зачина — по очереди
  const tried = await mapLimit(spots, 3, async ([options, opening], i) => {
    for (const [j, spot] of options.entries()) {
      try {
        const peek = await placeOne(path.join(workDir, "peek", `${i}_${j}`), pub, plan, spot, opening, figure, hooks);
        hooks.log(`владелец снизу: ${spot.line}:${spot.word} «${spot.target}», ${peek.fig.h} px`);
        return peek;
      } catch (error) {
        // вставка украшает ролик, но не держит его: без неё ролик всё равно выходит
        hooks.log(`без владельца на ${spot.line}:${spot.word}: ${(error as Error).message}`);
      }
    }
    return null;
  });
  const placed = tried.filter((p): p is OwnerPeek => p !== null);
  if (!placed.length) return;
  fs.mkdirSync(path.join(pub, "peek"), { recursive: true });
  fs.copyFileSync(figure, path.join(pub, "peek", POSE));
  plan.peeks = placed;
}
