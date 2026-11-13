import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImagePrompt, buildEditPrompt } from "../lib/carousel/imagePrompt";
import { paintedTextKey } from "../lib/carousel/painted";
import { DEFAULT_DESIGN, mergeDesign } from "../lib/carousel/designShared";
import { illustratedHash } from "../lib/carousel/illustrated";
import { generationSystem, generationUser, normalizeDraft } from "../lib/carousel/prompt";
import { AUTHOR_EDIT_RULES, paintedStoryProblems } from "../lib/carousel/storyDirection";

const design = { ...DEFAULT_DESIGN, artworkMode: "painted" as const, author: "TG:@owner_crypto", characterDescription: "Keep the youthful age and blue hoodie; match only the face." };
const slide = { kind: "cover" as const, title: "Почему ты покупаешь на пике?", body: "", bullets: [], kicker: "", cta: "", image: { brief: "Trader with Bitcoin", composition: "portrait", textPlacement: "top" as const, versions: [], rev: 0, status: "none" as const, attempts: 0 } };

test("a topic alone receives the saved character and coherent painted direction", () => {
  const system = generationSystem(true, design);
  assert.ok(system.includes(design.characterDescription));
  assert.match(system, /Hero/);
  assert.doesNotMatch(system, /текст сайт накладывает поверх|Картинки не содержат никакого текста|Никаких реальных людей/);
  const user = generationUser({ idea: "Как работает FOMO", wishes: "", slideCount: 6, language: "ru", format: "portrait", style: "graphite" }, { illustrated: true, design });
  assert.doesNotMatch(user, /текст поверх/);
  assert.match(generationSystem(true), /текст сайт накладывает поверх/);
});

test("new carousels follow ig-carousel text cards even when the account design is painted", () => {
  const deck = generationSystem(false, design, true);
  assert.doesNotMatch(deck, /Hero|мастихином|ЦЕЛЫЕ готовые карточки/);
  assert.match(deck, /stake — ставка/);
  const user = generationUser({ idea: "Как работает FOMO", wishes: "", slideCount: 8, language: "ru", format: "portrait", style: "graphite" }, { deck: true, design });
  assert.doesNotMatch(user, /рисованная|иллюстрац/);
});

test("quality gate catches the missing protagonist and crowded copy before image generation", () => {
  const draft = normalizeDraft({ slides: [
    { ...slide, image: { brief: "Hero fears missing a trade and holds a coin" } },
    { ...slide, title: "У покупки есть причина", body: "Я вхожу по своему сценарию.", image: { brief: "Hero writes in a notebook before buying" } },
    { ...slide, title: "Сохрани", image: { brief: "Hero closes his laptop with a calm expression" } },
  ], visual: { style: "Thick impasto oil painting", characters: [{ name: "Hero", look: "Young blond in blue hoodie" }] } }, { illustrated: true }).draft;
  assert.deepEqual(paintedStoryProblems(draft, design), []);
  const broken = structuredClone(draft);
  broken.visual!.characters = [];
  broken.visual!.style = "Typography added separately";
  broken.slides.forEach(s => { s.image!.brief = "A coin on a ceramic bowl"; s.body = "A".repeat(160); });
  const problems = paintedStoryProblems(broken, design);
  assert.ok(problems.some(p => p.includes("Hero")));
  assert.ok(problems.some(p => p.includes("110")));
  assert.ok(problems.some(p => p.includes("visual.style")));
  broken.caption = "Это не финансовый совет";
  broken.slides[1].body = "Проверь сам и поставь алерт";
  assert.ok(paintedStoryProblems(broken, design).some(p => p.includes("дисклеймеры")));
  assert.ok(!paintedStoryProblems(broken, design).some(p => p.includes("задание зрителю")), "advice is evaluated against intent, not banned by verb");
  const filler = structuredClone(draft);
  filler.slides[1].body = "Я считаю, что спрос вырастет.";
  assert.ok(paintedStoryProblems(filler, design).some(p => p.includes("вводные об авторстве")));
  filler.slides[0].title = "Почему я покупаю ETH?";
  filler.slides[1].body = "Позиция выражена конкретным аргументом.";
  assert.deepEqual(paintedStoryProblems(filler, design), []);
  assert.deepEqual(paintedStoryProblems(broken, { artworkMode: "overlay" }), []);
});

test("editor checks argument quality and implied author voice", () => {
  assert.match(AUTHOR_EDIT_RULES, /причинную связь/);
  assert.match(AUTHOR_EDIT_RULES, /специальный случай/);
  assert.match(AUTHOR_EDIT_RULES, /сохраняет порядок и смысл/);
  assert.doesNotMatch(AUTHOR_EDIT_RULES, /Пиши от лица автора естественно: «Я жду/);
});
test("painted generation and editing keep exact copy and distinguish portrait from style", () => {
  const prompt = buildImagePrompt({ design, visual: undefined, slide, index: 0, total: 6, format: "portrait", refs: { anchor: true, account: true, portrait: true } });
  assert.ok(prompt.includes(slide.title));
  assert.match(prompt, /TG:@owner_crypto/);
  assert.match(prompt, /PRIMARY CHARACTER MODEL/);
  assert.match(prompt, /SECONDARY likeness reference/);
  assert.match(prompt, /ATH in rich emerald green/);
  assert.match(prompt, /warm charcoal for supporting copy/);
  assert.match(prompt, /Do not default to blue or navy text/);
  assert.match(prompt, /LAST reference image is the author's portrait/);
  assert.doesNotMatch(prompt, /Do not draw any text/);
  const edit = buildEditPrompt({ instruction: "Fix face", slide, visual: undefined, design, index: 0, total: 6, hasAnchor: true, hasPortrait: true });
  assert.ok(edit.includes(slide.title));
  assert.match(edit, /LAST reference/);
  assert.doesNotMatch(edit, /Do not draw any text/);
});
test("painted text changes, author changes and reordering invalidate the image copy", () => {
  const key = paintedTextKey(slide, design, 0, 6);
  assert.notEqual(key, paintedTextKey({ ...slide, title: "Другая тема" }, design, 0, 6));
  assert.notEqual(key, paintedTextKey(slide, { ...design, author: "other" }, 0, 6));
  assert.notEqual(key, paintedTextKey(slide, design, 1, 6));
  assert.notEqual(illustratedHash({ format: "portrait", language: "ru", design }, slide, 0, 6), illustratedHash({ format: "portrait", language: "ru", design: { ...design, artworkMode: "overlay" } }, slide, 0, 6));
});
test("design persists character settings and validates painted mode", () => {
  const merged = mergeDesign(DEFAULT_DESIGN, design);
  assert.ok("design" in merged);
  if ("design" in merged) assert.equal(merged.design.characterDescription, design.characterDescription);
  assert.ok("error" in mergeDesign(DEFAULT_DESIGN, { artworkMode: "unknown" }));
});
