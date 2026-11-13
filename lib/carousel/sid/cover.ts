import sharp from "sharp";
import { nativeImageBridge } from "../../codexImageClient";
import { sidClaude } from "./claude";
import { extractJson } from "./content";

/**
 * Обложка — обычная фотография предмета истории (владелец 11.11: «чтобы не были ИИ»). Ноябрьские обложки выдавал
 * один и тот же постановочный кадр: человек в капюшоне со спины с телефоном у ноутбука в тёмной комнате — его просил
 * сам шаблон («a hood, a back view», тёмная нижняя треть, малая глубина резкости). У лучшей обложки аккаунта
 * (Ledger, 172 тыс.) в кадре была сама вещь: вскрытый кошелёк и пинцет у лишнего чипа. Теперь сцена — предмет крупно,
 * снятый как на телефон: ровный бытовой свет, всё в фокусе, случайная рамка. Готовую картинку смотрит Claude.
 */

/** Как выглядит настоящая фотография: общий вид для обложек и фото всех стилей. */
export const REAL_PHOTO =
  "An ordinary real photograph, the kind a witness, a repair technician or a newsroom photographer takes on a phone and posts together with the news: " +
  "flat everyday light (daylight from a window, office ceiling lamps or a direct on-camera flash), everything in focus from front to back, casual slightly off-centre framing with a small tilt, " +
  "true dull colors exactly as a phone records them, a little sensor noise, real worn surfaces with dust, scratches, cables and fingerprints. " +
  "The picture is plain and unposed, like a frame from somebody's camera roll.";

/** Сценаристу: что снимать на обложку. Образец — обложка Ledger. */
export const COVER_SCENE =
  "сам предмет истории крупным планом, каким его снял бы на телефон очевидец или эксперт и выложил вместе с новостью. Так сделана лучшая обложка аккаунта (172 тыс. просмотров): вскрытый аппаратный кошелёк на рабочем столе, пинцет показывает на лишний чип внутри. Читатель с первого взгляда видит вещь, о которой речь, и хочет рассмотреть её ближе. " +
  "Другие примеры: старый iPhone с трещиной на стекле лежит на кухонной клеёнке рядом с тетрадным листком в пустую линейку, рука тянется его перевернуть; разрезанная ножницами банковская карта и вскрытый конверт на подоконнике; дверца серверной стойки, заклеенная бумажной пломбой, из-под неё свисают выдернутые кабели; картонная коробка с изъятыми жёсткими дисками в багажнике машины. " +
  "Назови по-английски сам предмет, на чём он лежит, какой свет (дневной из окна, лампы офиса или вспышка телефона) и одну деталь, в которой вся новость. Из людей в кадре бывают только руки. У каждой карусели свой предмет и своё место";

export function coverPrompt(scene: string): string {
  return [
    `${REAL_PHOTO} No glow, no neon, no smoke, no fog, no light rays, no color grading. Vertical 4:5 composition.`,
    "",
    `Scene: ${scene.trim()}`,
    "",
    "Composition: the object of the story is large and close in the upper two thirds of the frame; the lower third is simply more of the plain surface it lies on (table top, floor, asphalt, car seat), calm and empty, for a title to be placed later. Only things that belong to the story are in the frame.",
    "",
    "Absolutely no text anywhere: no letters, words, numbers, logos, brand names, flags or watermarks; screens are switched off or show only plain blurred shapes, papers are blank or ruled. Of people the frame shows at most bare hands or a sleeve cut by the edge, the way they get into a casual photo; no faces, no recognizable real person.",
  ].join("\n");
}

const CHECK_SYSTEM =
  "You inspect a generated cover image for a social media carousel. Look carefully at the whole picture, including small screens, papers and signs. " +
  'Answer with JSON only: {"text": boolean, "face": boolean, "realPerson": boolean, "aiLook": boolean, "staged": boolean, "note": string}. ' +
  "text — any readable letters, digits, logos or brand marks; face — a human face is visible (not hidden by a hood, shadow or turned away); " +
  "realPerson — the person looks like a specific recognizable public figure; aiLook — at first glance it looks AI-generated rather than a plain phone photo: neon or glowing outlines, red or green glow flooding the frame, fire, smoke, fog or light rays, cinematic grading, creamy blurred background with a glossy too-clean subject, plastic skin, melted details; " +
  "staged — a stock-image cliche instead of the real thing: an anonymous hooded figure seen from behind with a phone or a laptop, a posed 'hacker', a moody dark room lit by a screen, symbolic props such as chains, padlocks, piles of coins or glass boxes with money. note — one short sentence in Russian.";

export type CoverCheck = { ok: boolean; note: string };

export async function checkCover(png: Buffer): Promise<CoverCheck> {
  const small = await sharp(png).resize(768).jpeg({ quality: 85 }).toBuffer();
  const answer = await sidClaude({ label: "карусель: проверка обложки", system: CHECK_SYSTEM, user: "Проверь обложку.", images: [{ base64: small.toString("base64"), mediaType: "image/jpeg" }], effort: "medium", timeoutMs: 6 * 60_000 });
  const r = extractJson(answer) as any;
  const bad = [r?.text && "на картинке есть буквы или логотипы", r?.face && "видно лицо", r?.realPerson && "похоже на реального человека", r?.aiLook && "с первого взгляда видно ИИ", r?.staged && "постановочный штамп вместо предмета истории"].filter(Boolean);
  return { ok: bad.length === 0, note: bad.length ? `${bad.join(", ")}${r?.note ? `: ${String(r.note).slice(0, 160)}` : ""}` : String(r?.note ?? "") };
}

/** До трёх попыток; если ни одна не прошла проверку, задание останавливается с причиной. */
export async function makeCover(scene: string, onStep: (text: string) => void): Promise<{ png: Buffer; prompt: string; notes: string[] }> {
  const prompt = coverPrompt(scene);
  const notes: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    onStep(attempt === 1 ? "Рисую обложку" : `Перерисовываю обложку (попытка ${attempt})`);
    const extra = notes.length ? `\n\nThe previous attempt was rejected: ${notes[notes.length - 1]}. Make it a plain phone photo of the object itself in ordinary light, with no faces and no text on any surface.` : "";
    const r = await nativeImageBridge({ prompt: prompt + extra, aspectRatio: "4:5", references: [], mode: "generate" });
    const png = await sharp(r.buffer).png().toBuffer();
    onStep("Проверяю обложку");
    const check = await checkCover(png);
    if (check.ok) return { png, prompt, notes };
    notes.push(check.note);
  }
  throw new Error(`Обложка не прошла проверку три раза: ${notes.join("; ")}`);
}
