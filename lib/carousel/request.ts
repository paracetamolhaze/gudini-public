import type { CarouselMode, CarouselRequest, ImageModelId, MemeCategory } from "./types";
import { CAROUSEL_LIMITS, DECK_LIMITS, IG_LIMITS, isFormat, isGenre, isLanguage, isMemeCategory } from "./limits";
import { DEFAULT_STYLE, isStyleId } from "./styles";
import { IMAGE_MODELS, isImageModelId } from "./models";
import { cleanText } from "./text";
import { autoMemeIdea } from "./meme";

/** deck — карусель по скиллу ig-carousel: текстовые карточки, которые собирает сайт. */
export type ParsedCreate = { request: CarouselRequest; mode: CarouselMode; deck?: boolean; imageModel?: ImageModelId };

/**
 * Проверка формы создания карусели. Ошибка — готовая фраза для пользователя.
 * Экспертная карусель собирается по скиллу ig-carousel из текстовых карточек (6–10 слайдов):
 * генератор картинок текст больше не рисует. Иллюстрации остались у мемов.
 */
export function parseCreateRequest(body: any, defaults: { imageModel: ImageModelId | null; memeCategory?: () => MemeCategory } = { imageModel: null }): ParsedCreate | { error: string } {
  const genre = body?.genre ?? "expert";
  if (!isGenre(genre)) return { error: "Неизвестный стиль карусели" };

  // мемы можно делать одной кнопкой: без темы и категории категория берётся по очереди, повод выбирает сценарист
  const typed = cleanText(body?.idea, { multiline: true });
  const rawCategory = body?.memeCategory;
  if (genre === "meme" && rawCategory !== undefined && rawCategory !== null && rawCategory !== "" && !isMemeCategory(rawCategory)) return { error: "Неизвестная категория мемов" };
  const memeCategory: MemeCategory | undefined = genre !== "meme" ? undefined : isMemeCategory(rawCategory) ? rawCategory : typed ? undefined : (defaults.memeCategory?.() ?? "trading");
  const idea = typed || (genre === "meme" && memeCategory ? autoMemeIdea(memeCategory) : "");
  if (idea.length < CAROUSEL_LIMITS.ideaMin) return { error: "Опишите идею карусели — хотя бы несколько слов" };
  if (idea.length > CAROUSEL_LIMITS.ideaMax) return { error: `Идея длиннее ${CAROUSEL_LIMITS.ideaMax} символов — сократите` };

  const wishes = cleanText(body?.wishes, { multiline: true });
  if (wishes.length > CAROUSEL_LIMITS.wishesMax) return { error: `Пожелания длиннее ${CAROUSEL_LIMITS.wishesMax} символов — сократите` };

  const deck = genre !== "meme";
  const limits = deck ? DECK_LIMITS : CAROUSEL_LIMITS;
  const rawCount = body?.slideCount;
  const slideCount = rawCount === undefined || rawCount === null || rawCount === "" ? limits.defaultSlides : Number(rawCount);
  if (!Number.isInteger(slideCount) || slideCount < limits.minSlides || slideCount > limits.maxSlides) {
    return { error: deck
      ? `Количество слайдов — от ${limits.minSlides} до ${limits.maxSlides}: обложка, ставка, итог и финал плюс хотя бы две мысли; больше ${IG_LIMITS.maxItems} Instagram не принимает`
      : `Количество слайдов — от ${limits.minSlides} до ${limits.maxSlides}: Instagram принимает в карусели не больше ${IG_LIMITS.maxItems} картинок` };
  }

  const language = body?.language ?? "ru";
  if (!isLanguage(language)) return { error: "Неизвестный язык" };
  const style = body?.style ?? DEFAULT_STYLE;
  if (!isStyleId(style)) return { error: "Неизвестный визуальный стиль" };
  const format = body?.format ?? "portrait";
  if (!isFormat(format)) return { error: "Неизвестный формат" };

  if (body?.mode === "text_cards" && genre === "meme") return { error: "Мем-карусель рисуется с иллюстрациями" };
  const mode: CarouselMode = deck ? "text_cards" : "illustrated";
  const request: CarouselRequest = { idea, wishes, slideCount, language, style, format, genre, ...(memeCategory ? { memeCategory } : {}) };
  if (deck) return { request, mode, deck };

  const rawModel = body?.imageModel ?? defaults.imageModel;
  if (!rawModel) return { error: "Не задана модель изображений (CAROUSEL_IMAGE_MODEL)" };
  if (!isImageModelId(rawModel)) return { error: `Модель изображений «${String(rawModel).slice(0, 60)}» не поддерживается разделом (доступны: ${Object.values(IMAGE_MODELS).map((m) => m.label).join(", ")})` };
  request.imageModel = rawModel;
  return { request, mode, imageModel: rawModel };
}
