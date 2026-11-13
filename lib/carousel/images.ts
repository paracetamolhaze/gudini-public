import fs from "fs";
import { nativeImageBridge, CodexImageError } from "../codexImageClient";
import type { Carousel, ImageReference, ImageVersion, Slide } from "./types";
import { carouselApiKey, defaultImageModel, imageConcurrency, imageResolution, imageTimeoutMs, KEY_ENV, imageTransport } from "./config";
import { IMAGE_MODELS, imageEstimate, requestResolution } from "./models";
import { generateImage as realGenerate, OpenRouterError, type ImageRequest, type ImageResult } from "./openrouter";
import { buildEditPrompt, buildImagePrompt } from "./imagePrompt";
import { dataUrl, extensionFor, imageDimensions } from "./imageFile";
import { readBrandFile } from "./design";
import { DEFAULT_DESIGN } from "./designShared";
import { reserveSpend, settleSpend } from "./spend";
import { CarouselError, getCarousel, imageFilePath, listCarousels, newId, notFound, updateCarousel, writeFileAtomic } from "./store";
import { mapLimit } from "../concurrency";
import { artTextKey, isMemeDesign, MEME_ART_FIXES, MEME_CHECK_RULES, memeCheckUser, memeTexts, parseMemeCheck } from "./meme";
import { codexComplete, codexEffort } from "../codexLlm";
import { textModel } from "./config";
import { extractJson } from "./prompt";

/**
 * Иллюстрации карусели. Каждая генерация — отдельная версия у слайда: версии не удаляются,
 * к любой можно вернуться. Первая удачная картинка серии становится опорой (anchor) и уходит
 * референсом во все следующие запросы вместе с референсом аккаунта, поэтому стиль и
 * персонажи держатся не одним словом «сохрани стиль».
 *
 * Резерв бюджета ставится до запроса, отметка inFlight — тоже: если обработчик умрёт с
 * отправленным запросом, при возобновлении слайд получает статус «исход неизвестен», а не
 * повторную оплату вслепую. Поздний ответ не перезаписывает более новую правку пользователя:
 * версия сохраняется, но текущей становится только при неизменной rev слайда.
 */

export type ImageDeps = { generate: (req: ImageRequest) => Promise<ImageResult> };
let deps: ImageDeps = { generate: realGenerate };

/** Только для тестов: подменить генератор. */
export function setImageDeps(d: Partial<ImageDeps> | null): void {
  deps = { generate: d?.generate ?? realGenerate };
}

export type ImageOutcome = { slideId: string; index: number; ok: boolean; skipped?: boolean; uncertain?: boolean; notCurrent?: boolean; error?: string };

export type GenerateOpts = {
  mode: "generate" | "edit";
  instruction?: string;
  hint?: string;
  /** повторить и слайды с неизвестным исходом — явное решение пользователя */
  includeUncertain?: boolean;
};

const UNCERTAIN_TEXT = "Ответ генератора не получен: запрос мог выполниться и использовать лимиты или бюджет. Проверьте результат и повторите генерацию этого слайда вручную.";

export function resolveImageModel(c: Pick<Carousel, "imageModel">) {
  const id = imageTransport() === "codex" ? "codex/imagegen" : c.imageModel ?? defaultImageModel().id;
  if (!id) throw new CarouselError(defaultImageModel().problem ?? "Не задана модель изображений", 503, "config");
  return IMAGE_MODELS[id];
}

function currentVersion(slide: Slide): ImageVersion | undefined {
  const img = slide.image;
  return img?.versions.find((v) => v.id === img.currentId);
}

function fileExists(id: string, file: string | undefined): boolean {
  if (!file) return false;
  try {
    return fs.existsSync(imageFilePath(id, file));
  } catch {
    return false;
  }
}

type Ref = ImageReference & { url: string };

function collectRefs(c: Carousel, slide: Slide, mode: "generate" | "edit", max: number): Ref[] {
  const refs: Ref[] = [];
  if (mode === "edit") {
    const v = currentVersion(slide);
    if (v && fileExists(c.id, v.file)) refs.push({ kind: "source", file: v.file, url: dataUrl(fs.readFileSync(imageFilePath(c.id, v.file))) });
  }
  if (c.anchor && c.anchor.slideId !== slide.id && fileExists(c.id, c.anchor.file)) {
    refs.push({ kind: "anchor", file: c.anchor.file, url: dataUrl(fs.readFileSync(imageFilePath(c.id, c.anchor.file))) });
  }
  const brand = readBrandFile(c.design?.referenceFile);
  if (brand && c.design?.referenceFile) refs.push({ kind: "account", file: c.design.referenceFile, url: dataUrl(brand) });
  const portrait = readBrandFile(c.design?.portraitFile);
  if (portrait && c.design?.portraitFile && max > 0) {
    return [...refs.slice(0, Math.max(0, max - 1)), { kind: "portrait", file: c.design.portraitFile, url: dataUrl(portrait) }];
  }
  return refs.slice(0, Math.max(0, max));
}

const strip = (refs: Ref[]): ImageReference[] => refs.map(({ kind, file }) => ({ kind, file }));

/** Одна иллюстрация для одного слайда. Ошибка бюджета пробрасывается: задание должно остановиться. */
export async function generateSlideImage(id: string, jobId: string, slideId: string, opts: GenerateOpts, retryOnce = true): Promise<ImageOutcome> {
  let c = getCarousel(id);
  if (!c) throw notFound();
  let index = c.slides.findIndex((s) => s.id === slideId);
  if (index < 0) return { slideId, index: -1, ok: false, error: "слайд удалён" };
  const slide = c.slides[index];
  const img = slide.image;
  const fail = (error: string, status: "error" | "uncertain" = "error") => {
    updateCarousel(id, (x) => {
      const s = x.slides.find((y) => y.id === slideId);
      if (!s?.image) return;
      s.image.status = status;
      s.image.error = error;
      s.image.inFlight = undefined;
    });
    return { slideId, index, ok: false, error, uncertain: status === "uncertain" };
  };

  if (!img || !img.brief) return fail("нет описания иллюстрации — перегенерируйте содержание слайда");
  if (imageTransport() === "openrouter" && !carouselApiKey()) throw new CarouselError(`Требуется ключ OpenRouter для каруселей (${KEY_ENV}) — генерация не запускалась`, 503, "config");

  if (img.inFlight) {
    // запрос предыдущего запуска ушёл, ответ записан не был: исход неизвестен
    settleSpend(img.inFlight.spendId, { status: "uncertain", note: "обработчик прерван до ответа генератора" });
    if (!opts.includeUncertain) return fail(UNCERTAIN_TEXT, "uncertain");
    updateCarousel(id, (x) => {
      const s = x.slides.find((y) => y.id === slideId);
      if (s?.image) s.image.inFlight = undefined;
    });
  } else if (img.status === "uncertain" && opts.mode === "generate" && !opts.includeUncertain && !opts.hint) {
    return { slideId, index, ok: false, skipped: true, uncertain: true, error: img.error };
  }
  if (opts.mode === "edit" && !currentVersion(slide)) return fail("нет текущей картинки — сначала сгенерируйте иллюстрацию");

  const model = resolveImageModel(c);
  const resolution = requestResolution(model.id, imageResolution());
  const design = c.design ?? DEFAULT_DESIGN;
  const refs = collectRefs(c, slide, opts.mode, model.maxReferences);
  const hasAnchor = refs.some((r) => r.kind === "anchor");
  const prompt =
    opts.mode === "edit"
      ? buildEditPrompt({ instruction: opts.instruction ?? "", slide, visual: c.visual, hasAnchor, design, index, total: c.slides.length, hasPortrait: refs.some((r) => r.kind === "portrait") })
      : buildImagePrompt({ visual: c.visual, design, slide, index, total: c.slides.length, format: c.format, refs: { anchor: hasAnchor, account: refs.some((r) => r.kind === "account"), portrait: refs.some((r) => r.kind === "portrait") } }) +
        (opts.hint ? `\nAdditional wish from the author for this slide: ${opts.hint}` : "");
  const estimate = imageEstimate(model.id, resolution);
  const rev0 = img.rev;

  let entry;
  try {
    entry = reserveSpend({
      carouselId: id,
      title: c.title,
      kind: "image",
      label: `${opts.mode === "edit" ? "Правка иллюстрации" : "Иллюстрация"} слайда ${index + 1}`,
      runLabel: opts.mode === "edit" ? "Карусель: правка иллюстрации" : "Карусель: иллюстрации",
      model: model.id,
      estimate,
      billing: model.id === "codex/imagegen" ? "subscription" : undefined,
      jobId,
      slideId,
    });
  } catch (e) {
    if (e instanceof CarouselError) fail(e.message);
    throw e;
  }
  updateCarousel(id, (x) => {
    const s = x.slides.find((y) => y.id === slideId);
    if (!s?.image) return;
    s.image.status = "generating";
    s.image.error = undefined;
    s.image.inFlight = { at: new Date().toISOString(), jobId, spendId: entry.id };
  });

  try {
    const r = model.id === "codex/imagegen" ? await nativeImageBridge({ prompt, aspectRatio: model.aspect[c.format] as "4:5" | "1:1", references: refs.map(x => x.url), mode: opts.mode }) : await deps.generate({ model: model.id, prompt, aspectRatio: model.aspect[c.format], resolution, quality: model.quality, references: refs.map((x) => x.url), timeoutMs: imageTimeoutMs() });
    const dims = imageDimensions(r.buffer) ?? { width: 0, height: 0 };
    const versionId = newId("v");
    const file = `img-${slideId}-${versionId}.${extensionFor(r.mediaType)}`;
    if (!getCarousel(id)) throw notFound();
    writeFileAtomic(imageFilePath(id, file), r.buffer);
    const version: ImageVersion = {
      id: versionId,
      file,
      mediaType: r.mediaType,
      paintedTextKey: design.artworkMode === "painted" ? artTextKey(slide, design, index, c.slides.length) : undefined,
      width: dims.width,
      height: dims.height,
      bytes: r.buffer.length,
      model: model.id,
      resolution,
      kind: opts.mode,
      prompt,
      instruction: opts.instruction,
      references: strip(refs),
      cost: r.cost ?? estimate,
      estimated: r.cost === null,
      at: new Date().toISOString(),
    };
    let notCurrent = false;
    c = updateCarousel(
      id,
      (x) => {
        const s = x.slides.find((y) => y.id === slideId);
        if (!s?.image) return;
        x.imageModel = model.id;
        s.image.versions.push(version);
        s.image.inFlight = undefined;
        s.image.attempts += 1;
        s.image.status = "ready";
        s.image.error = undefined;
        if (s.image.rev === rev0) s.image.currentId = version.id;
        else notCurrent = true;
        if (!notCurrent && (!x.anchor || !fileExists(id, x.anchor.file) || x.anchor.slideId === slideId)) x.anchor = { slideId, versionId: version.id, file };
      },
      { content: true },
    );
    settleSpend(entry.id, { status: "done", cost: r.cost });
    index = c.slides.findIndex((s) => s.id === slideId);
    return { slideId, index, ok: true, notCurrent };
  } catch (e) {
    const or = e instanceof OpenRouterError ? e : null;
    if (or?.uncertain || e instanceof CodexImageError) {
      settleSpend(entry.id, { status: "uncertain", note: (e as Error).message });
      updateCarousel(id, (x) => {
        const s = x.slides.find((y) => y.id === slideId);
        if (s?.image) s.image.attempts += 1;
      });
      return fail(UNCERTAIN_TEXT, "uncertain");
    }
    if (e instanceof CarouselError && e.status === 404) throw e;
    const message = or ? or.message : String((e as any)?.message ?? e).slice(0, 300);
    settleSpend(entry.id, { status: "failed", cost: or?.cost ?? 0, note: message });
    // подтверждённая ошибка: запрос не выполнен, отметка «в полёте» снимается до возможного повтора
    updateCarousel(id, (x) => {
      const s = x.slides.find((y) => y.id === slideId);
      if (!s?.image) return;
      s.image.attempts += 1;
      s.image.inFlight = undefined;
    });
    if (or?.retryable && retryOnce) return generateSlideImage(id, jobId, slideId, opts, false);
    return fail(message);
  }
}

export type Step = (text: string, progress: number) => void;

/** Проверка текущей картинки мема строгим редактором; сбой проверки картинку не блокирует. */
async function checkMemeArt(id: string, jobId: string, slideId: string): Promise<{ ok: boolean; problems: string[] }> {
  const c = getCarousel(id);
  const slide = c?.slides.find((s) => s.id === slideId);
  const v = slide && currentVersion(slide);
  if (!c || !slide || !v || !fileExists(id, v.file)) return { ok: true, problems: [] };
  const model = textModel().id;
  const entry = reserveSpend({ carouselId: id, title: c.title, kind: "text", label: `Проверка картинки слайда ${c.slides.indexOf(slide) + 1}`, runLabel: "Карусель: проверка картинок", model, estimate: 0, jobId, slideId, billing: "subscription" });
  try {
    const r = await codexComplete({ system: MEME_CHECK_RULES, user: memeCheckUser(slide), stage: "Carousel Text", model, effort: codexEffort("Carousel Text"), images: [{ base64: fs.readFileSync(imageFilePath(id, v.file)).toString("base64"), mediaType: v.mediaType }] });
    settleSpend(entry.id, { status: "done", cost: 0, note: "Подписка ChatGPT" });
    return parseMemeCheck(extractJson(r.text), memeTexts(slide));
  } catch (e) {
    settleSpend(entry.id, { status: "failed", cost: 0, note: String((e as Error).message).slice(0, 200) });
    return { ok: true, problems: [] };
  }
}

/**
 * Картинка слайда с проверкой: у мема строгий редактор ищет очевидные дефекты (лишние руки,
 * двойники, опечатки в пузырях), и найденное исправляется точечной правкой картинки.
 */
export async function generateCheckedSlideImage(id: string, jobId: string, slideId: string, opts: GenerateOpts): Promise<ImageOutcome> {
  let out = await generateSlideImage(id, jobId, slideId, opts);
  if (!isMemeDesign(getCarousel(id)?.design)) return out;
  for (let fix = 0; fix < MEME_ART_FIXES && out.ok && !out.notCurrent; fix++) {
    const verdict = await checkMemeArt(id, jobId, slideId);
    if (verdict.ok) break;
    const instruction = `Fix these defects and keep everything else identical: ${verdict.problems.join("; ")}.`;
    out = await generateSlideImage(id, jobId, slideId, { mode: "edit", instruction, includeUncertain: true });
  }
  return out;
}

/**
 * Иллюстрации для нескольких слайдов. Пока у серии нет опоры, первый слайд рисуется один —
 * его картинка станет референсом остальных; дальше — параллельно в пределах лимита раздела.
 */
export async function generateSlideImages(id: string, jobId: string, slideIds: string[], step: Step, range: [number, number], opts: Omit<GenerateOpts, "mode"> = {}): Promise<ImageOutcome[]> {
  const c = getCarousel(id);
  if (!c) throw notFound();
  const ordered = c.slides.filter((s) => slideIds.includes(s.id)).map((s) => s.id);
  const total = ordered.length;
  const outcomes: ImageOutcome[] = [];
  let done = 0;
  const report = () => step(`Иллюстрации: ${done} из ${total}`, range[0] + ((range[1] - range[0]) * done) / Math.max(1, total));
  report();
  const one = async (sid: string) => {
    const out = await generateCheckedSlideImage(id, jobId, sid, { mode: "generate", ...opts });
    outcomes.push(out);
    done += 1;
    report();
  };
  let rest = ordered;
  const anchorTarget = c.anchor && ordered.includes(c.anchor.slideId) ? c.anchor.slideId : undefined;
  if (ordered.length && (anchorTarget || !(c.anchor && fileExists(id, c.anchor.file)))) {
    const first = anchorTarget ?? ordered[0];
    await one(first);
    rest = ordered.filter(sid => sid !== first);
    if (!outcomes[0]?.ok || outcomes[0]?.notCurrent) return outcomes;
  }
  await mapLimit(rest, imageConcurrency(), one);
  return outcomes.sort((a, b) => a.index - b.index);
}

/** Слайды, которым нужна иллюстрация: без текущей картинки или с ошибкой. Неизвестный исход — только по явному запросу. */
export function slidesNeedingImages(c: Carousel, includeUncertain = false): string[] {
  return c.slides
    .filter((s, index) => {
      const img = s.image;
      if (!img) return false;
      if (img.inFlight) return true;
      if (img.status === "uncertain") return includeUncertain;
      const version = currentVersion(s);
      return !version || img.status === "error" || (c.design?.artworkMode === "painted" && version.paintedTextKey !== artTextKey(s, c.design, index, c.slides.length));
    })
    .map((s) => s.id);
}

/** Заявки, оставшиеся «в полёте» после смерти обработчика: их исход неизвестен. Вызывается при старте обработчика. */
export function markOrphanInFlight(): number {
  let n = 0;
  for (const c of listCarousels()) {
    if (!c.slides.some((s) => s.image?.inFlight)) continue;
    try {
      updateCarousel(c.id, (x) => {
        for (const s of x.slides) {
          if (!s.image?.inFlight) continue;
          settleSpend(s.image.inFlight.spendId, { status: "uncertain", note: "обработчик прерван до ответа генератора" });
          s.image.inFlight = undefined;
          s.image.status = "uncertain";
          s.image.error = UNCERTAIN_TEXT;
          n++;
        }
      });
    } catch {}
  }
  return n;
}

export function imageSummary(c: Carousel): { total: number; ready: number; failed: number; uncertain: number; generating: number } {
  const out = { total: 0, ready: 0, failed: 0, uncertain: 0, generating: 0 };
  for (const s of c.slides) {
    const img = s.image;
    if (!img) continue;
    out.total++;
    if (img.status === "generating" || img.inFlight) out.generating++;
    else if (img.status === "uncertain") out.uncertain++;
    else if (currentVersion(s)) out.ready++;
    else out.failed++;
  }
  return out;
}
