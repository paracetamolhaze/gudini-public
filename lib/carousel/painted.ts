import crypto from "crypto";
import type { DesignSettings, Slide } from "./types";

type TextSlide = Partial<Pick<Slide, "title" | "body" | "bullets" | "kicker" | "cta">>;
export const PAINTED_COLOR_RULES = "Select the lettering palette to complement the actual background and illustration: on warm ivory use deep warm charcoal or dark umber for the headline, warm charcoal for supporting copy; on a darker background use warm ivory lettering with strong contrast. Do not default to blue or navy text: the character's blue hoodie does not dictate typography. Mandatory signature exception: always paint the entire exact footer TG:@owner_crypto in a clearly legible saturated blue on every slide, regardless of the headline or accent palette and reference colors. This signature is exempt from the no-blue-default and accent-family limits. Paint every occurrence of ATH in rich emerald green. Use at most one additional accent family, muted terracotta for risk/loss or deep forest green for growth, only on meaningful short phrases. Keep the same restrained palette throughout this carousel; no rainbow lettering and no low contrast text. These color rules override generic all-navy typography in the series description or references.";
export function paintedCopy(slide: TextSlide, design: Pick<DesignSettings, "author">, index: number, total: number) {
  return { title: slide.title ?? "", body: slide.body ?? "", bullets: slide.bullets ?? [], kicker: slide.kicker ?? "", cta: slide.cta ?? "", author: design.author, counter: `${index + 1}/${total}` };
}
export function paintedTextKey(slide: TextSlide, design: Pick<DesignSettings, "author">, index: number, total: number): string {
  return crypto.createHash("sha256").update(JSON.stringify(paintedCopy(slide, design, index, total))).digest("hex");
}
export function paintedInstructions(slide: TextSlide, design: Pick<DesignSettings, "author">, index: number, total: number): string {
  return `Create the COMPLETE finished carousel card, including painted lettering. Large impasto headline at top, clear smaller supporting copy below, illustration in the lower half, author along bottom, counter at upper right. Warm ivory textured background. ${PAINTED_COLOR_RULES} All lettering must fit inside generous safe margins and be legible on a phone. Copy this text exactly (JSON field names are not to be drawn): ${JSON.stringify(paintedCopy(slide, design, index, total))}. Underscores in the author handle must be long horizontal strokes on the baseline, never dots. Do not add other text. Do not copy text from references.`;
}
