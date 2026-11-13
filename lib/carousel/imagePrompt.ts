import type { CarouselFormat, DesignSettings, Slide, VisualConcept } from "./types";
import { paintedInstructions } from "./painted";
import { isMemeDesign, memePaintedInstructions, MEME_PORTRAIT_LINE } from "./meme";

/**
 * Промпты генератора изображений. Смысл конкретного слайда задаёт Claude (brief и composition),
 * а общая часть серии — стиль, палитра, свет, персонажи — одинаковая для всех слайдов и
 * подкрепляется референсом: уже одобренной картинкой серии и референсом аккаунта.
 *
 * Текст на карточке рисует сайт, поэтому генератор просят оставить спокойную зону под текст
 * и не рисовать никаких надписей.
 */

export type PromptRefs = { anchor: boolean; account: boolean; portrait?: boolean };
type PromptDesign = Pick<DesignSettings, "illustrationStyle"> & Partial<DesignSettings>;

const zoneWord = (placement: "top" | "bottom") => (placement === "top" ? "upper" : "lower");

function seriesLines(visual: VisualConcept | undefined, design: PromptDesign): string[] {
  const v = visual;
  const lines: string[] = [];
  if (v?.style) lines.push(`Art direction for the whole series: ${v.style}.`);
  if (v?.palette) lines.push(`Palette: ${v.palette}.`);
  if (v?.lighting) lines.push(`Lighting: ${v.lighting}.`);
  if (design.illustrationStyle) lines.push(`Preferred illustration style of the account (author's words): ${design.illustrationStyle}.`);
  if (v?.characters?.length) {
    lines.push(`Recurring characters — keep exactly the same appearance, age, clothing and proportions on every slide: ${v.characters.map((c) => `${c.name}: ${c.look}`).join("; ")}.`);
  }
  if (v?.objects?.length) lines.push(`Recurring objects, drawn the same way each time: ${v.objects.join("; ")}.`);
  if (design.characterDescription) lines.push(`Author's character requirements take priority over generic character descriptions: ${design.characterDescription}`);
  return lines;
}

const NO_TEXT = "Do not draw any text, letters, numbers, captions, speech bubbles, logos, watermarks, signatures or interface elements.";

export function buildImagePrompt(a: {
  visual: VisualConcept | undefined;
  design: PromptDesign;
  slide: Pick<Slide, "kind" | "image"> & Partial<Slide>;
  index: number;
  total: number;
  format: CarouselFormat;
  refs: PromptRefs;
}): string {
  const img = a.slide.image;
  if (!img) throw new Error("у слайда нет описания иллюстрации");
  const lines = [
    `Illustration for slide ${a.index + 1} of ${a.total} of one Instagram carousel series.`,
    ...seriesLines(a.visual, a.design),
    `What this particular slide shows: ${img.brief}`,
    img.composition ? `Composition: ${img.composition}.` : "",
    isMemeDesign(a.design) ? memePaintedInstructions(a.slide) : a.design.artworkMode === "painted" ? paintedInstructions(a.slide, { author: a.design.author ?? "" }, a.index, a.total) : `Keep the ${zoneWord(img.textPlacement)} 40% of the frame visually calm and uncluttered — soft background, no faces or key details there — because a headline will be placed over that area later.`,
    a.refs.anchor
      ? "Reference image 1 is an already approved slide of this same series: match its art style, palette, lighting, rendering technique and the look of recurring characters exactly, but build a new composition for this slide; do not copy its layout."
      : "",
    a.refs.account
      ? `${a.refs.anchor ? "The next reference image" : "The reference image"} shows the account's approved artwork.${a.design.characterDescription ? " It is the PRIMARY CHARACTER MODEL, not just a mood reference: preserve that EXACT illustrated face design, youthful age, oversized expressive eyes, head-to-body proportions, short blond hair and navy hoodie. Change only the pose, expression and scene. Do not redesign him as a realistic adult, narrow his eyes, lengthen his face or sharpen his jaw. This approved illustrated character takes priority over the photographic portrait and over any generic visual.characters description." : " Follow its style and mood."} Do not copy its scene or words.`
      : "",
    a.refs.portrait && isMemeDesign(a.design) ? MEME_PORTRAIT_LINE : a.refs.portrait ? "The LAST reference image is the author's portrait: SECONDARY likeness reference only. The approved illustrated character already incorporates this likeness; do not reconstruct a new face from the photo. Keep the cartoon facial proportions and youthful age from the approved artwork, never the realistic adult proportions of the photograph. Do NOT copy the photo's clothing, body or photographic rendering. Preserve the navy blue hoodie, no beard or aging. On object-only slides do not add a person." : "",
    a.design.artworkMode === "painted" ? "Anatomically coherent poses: one left and one right hand, correct shoulder connections, no duplicated limbs." : NO_TEXT,
    a.format === "square" ? "Square 1:1 frame." : "Vertical portrait frame.",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Правка готовой иллюстрации поручением: первая картинка-референс — текущая версия слайда. */
export function buildEditPrompt(a: { instruction: string; slide: Pick<Slide, "image"> & Partial<Slide>; visual: VisualConcept | undefined; hasAnchor: boolean; design?: DesignSettings; index?: number; total?: number; hasPortrait?: boolean }): string {
  const img = a.slide.image;
  const placement = img?.textPlacement ?? "bottom";
  return [
    "Edit reference image 1 (the current illustration of this slide).",
    `Instruction from the author: ${a.instruction}`,
    "Change only what the instruction asks for. Keep the composition, characters, objects, style, palette and camera angle otherwise identical.",
    a.hasAnchor ? "Reference image 2 is another approved slide of the same series — keep the result consistent with it in style and character appearance." : "",
    a.visual?.style ? `Series art direction: ${a.visual.style}.` : "",
    a.design?.characterDescription ?? "",
    a.hasPortrait && isMemeDesign(a.design) ? MEME_PORTRAIT_LINE : a.hasPortrait ? "The LAST reference is the author's portrait. Match only head, face and hairstyle; retain the young illustrated age and navy blue hoodie. Do not add a person to an object-only slide." : "",
    isMemeDesign(a.design) ? memePaintedInstructions(a.slide) : a.design?.artworkMode === "painted" ? paintedInstructions(a.slide, a.design, a.index ?? 0, a.total ?? 1) : `Keep the ${zoneWord(placement)} 40% of the frame calm and uncluttered for text.`,
    a.design?.artworkMode === "painted" ? "Preserve the painted lettering style." : NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n");
}
