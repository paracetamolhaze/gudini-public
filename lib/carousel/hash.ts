import type { Carousel, Slide } from "./types";
import { slideHash } from "./templates";
import { illustratedHash } from "./illustrated";
import { deckHash } from "./deckHtml";
import { isDeck } from "./deck";
import { TELEGRAM_CHANNEL } from "./channel";
import { DEFAULT_DESIGN } from "./designShared";
import { sidSlideHash } from "./sid/hash";

/**
 * Отпечаток готовой карточки: у текстовых карточек — шаблон цвета, у иллюстрированных — картинка
 * и оформление, у карточек по скиллу — тексты и оформление аккаунта.
 */
export function slideContentHash(c: Pick<Carousel, "schema" | "mode" | "style" | "format" | "language" | "footer" | "design">, slide: Slide, index: number, total: number): string {
  if (c.schema === 4) return sidSlideHash(slide.id);
  if (c.mode === "illustrated") return illustratedHash({ format: c.format, language: c.language, design: c.design ?? DEFAULT_DESIGN }, slide, index, total);
  if (isDeck(c)) return deckHash({ format: c.format, language: c.language, design: c.design ?? DEFAULT_DESIGN }, slide, index, total, TELEGRAM_CHANNEL);
  return slideHash(c, slide, index, total);
}
