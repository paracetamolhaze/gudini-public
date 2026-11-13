import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNewsCoverPrompt, checkHeadline, FRAME_POINTS, HEADLINE_MAX, INTRO_SECONDS, pickFrame, scoreFrame, lettersOf, OUTFITS } from "../lib/news/cover";

/** The parts of the «Новости» cover that need neither the image bridge nor the live publishing code. */

const frame = (rgb: [number, number, number][], n = 100) => {
  const px = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) px.set(rgb[i % rgb.length], i * 3);
  return px;
};

test("кадр для обложки: контрастный и с лицом лучше тёмного и пустого; не из вспышки в начале", () => {
  const dark = scoreFrame(frame([[5, 5, 5]]));
  const flat = scoreFrame(frame([[128, 128, 128]]));
  const white = scoreFrame(frame([[250, 250, 250], [240, 240, 240]]));
  const contrast = scoreFrame(frame([[20, 20, 30], [230, 230, 220]]));
  const face = scoreFrame(frame([[20, 20, 30], [230, 230, 220], [210, 160, 120]]));
  assert.equal(dark, 0);
  assert.equal(flat, 0, "a single color is no reference");
  assert.equal(white, 0, "a washed-out frame neither");
  assert.ok(contrast > 0);
  assert.ok(face > 0);
  assert.equal(scoreFrame(new Uint8Array(0)), 0);
  assert.equal(pickFrame([{ at: 3, score: 0 }, { at: 6, score: 0.3 }, { at: 9, score: 0.2 }], 30), 6);
  assert.equal(pickFrame([{ at: 3, score: 0 }], 30), 30 * FRAME_POINTS[0], "none scores: 30%");
  assert.equal(pickFrame([], 3), INTRO_SECONDS, "a short video: never from the opening flash");
});

test("промпт обложки: два стиля владельца, точный заголовок, вещь истории, ключевое слово, ничего от «3Д»", () => {
  const concept = {
    headline: "ВАЗЕЛИН ПО-КОРЕЙСКИ",
    headlineLines: [{ text: "ВАЗЕЛИН" }, { text: "ПО-КОРЕЙСКИ" }] as never,
    headlineAnchor: ["вазелин"],
    emotion: "smug surprise",
    scene: { mainSubject: "", storyObject: "jar", environment: "bathroom" },
    composition: { facePosition: "center" as const, faceScale: "large" as const, headlineArea: "lower" as const, allowHands: false },
    design_notes: [],
  };
  const poster = buildNewsCoverPrompt(concept, "poster");
  assert.match(poster, /"ВАЗЕЛИН ПО-КОРЕЙСКИ"/);
  assert.match(poster, /Cinematic movie-poster look/);
  assert.match(poster, /the jar glowing softly/);
  assert.match(poster, /the word ВАЗЕЛИН in red/);
  assert.match(poster, /Ignore any subtitles/);
  const post = buildNewsCoverPrompt(concept, "post");
  assert.match(post, /social-media post card/);
  assert.match(post, /the word ВАЗЕЛИН in a yellow box/);
  for (const prompt of [poster, post]) assert.doesNotMatch(prompt, /YORK|voxel|#d97757|Claude/);
  // без якоря в заголовке цветным становится последнее слово
  assert.match(buildNewsCoverPrompt({ ...concept, headlineAnchor: ["кореянка"] }, "poster"), /the word ПО-КОРЕЙСКИ in red/);
  assert.equal(lettersOf("Вазелин сдался!"), lettersOf("ВАЗЕЛИН  СДАЛСЯ"));
  assert.notEqual(lettersOf("ВАЗЕЛИН СДАСЯ"), lettersOf("ВАЗЕЛИН СДАЛСЯ"));
});

test("обложка с владельцем: он главный, лицо по его фото, своя одежда, в постере без свечения на человеке", () => {
  const concept = {
    headline: "ВАЗЕЛИН ПО-КОРЕЙСКИ",
    headlineLines: [{ text: "ВАЗЕЛИН ПО-КОРЕЙСКИ" }] as never,
    headlineAnchor: ["вазелин"],
    emotion: "smug surprise",
    scene: { mainSubject: "", storyObject: "jar", environment: "bathroom" },
    composition: { facePosition: "center" as const, faceScale: "large" as const, headlineArea: "lower" as const, allowHands: false },
    design_notes: [],
  };
  const poster = buildNewsCoverPrompt(concept, "poster", { outfit: OUTFITS[1] });
  assert.match(poster, /references 2, 3, 4 and 5 is the channel's host/);
  assert.match(poster, /1:1 likeness/);
  assert.match(poster, new RegExp(`He wears ${OUTFITS[1]}`));
  assert.match(poster, /no golden or orange glow on the person/);
  const post = buildNewsCoverPrompt(concept, "post", { outfit: OUTFITS[0] });
  assert.match(post, /showing the hero of the story from reference 1 with jar/);
  assert.match(post, /the host pops out over the bottom edge of the card/);
});

test("заголовок владельца: пробелы чистятся, длинный — 400", () => {
  assert.equal(checkHeadline("  вазелин   по-корейски "), "вазелин по-корейски");
  assert.equal(checkHeadline(""), undefined);
  assert.equal(checkHeadline(null), undefined);
  assert.equal(checkHeadline("   "), undefined);
  assert.throws(() => checkHeadline("x".repeat(HEADLINE_MAX + 1)), (e: { status?: number }) => e.status === 400);
  assert.throws(() => checkHeadline(5), (e: { status?: number }) => e.status === 400);
});

test("обложка как у «Вазелина»: картинка героя с кадра без букв, 4:5 под сетку, без владельца", () => {
  const concept = {
    headline: "ВАЗЕЛИН СМЕНИЛ ИМЯ",
    headlineLines: [{ text: "ВАЗЕЛИН" }, { text: "СМЕНИЛ ИМЯ" }] as never,
    headlineAnchor: ["вазелин"],
    emotion: "surprised amusement",
    scene: { mainSubject: "", storyObject: "jar", environment: "bathroom" },
    composition: { facePosition: "center" as const, faceScale: "large" as const, headlineArea: "lower" as const, allowHands: false },
    design_notes: [],
  };
  const hero = buildNewsCoverPrompt(concept, "hero", { outfit: OUTFITS[0] });
  assert.match(hero, /Redraw it as a punchy photographic viral news cover picture/);
  assert.match(hero, /The hero fills the upper 60% of the picture/);
  assert.match(hero, /surprised amusement/);
  assert.match(hero, /the jar may appear next to them/);
  assert.match(hero, /The lower 40% continues the same scene calmly/, "room for our headline");
  assert.match(hero, /Absolutely no text/);
  assert.match(hero, /Vertical 4:5/);
  assert.match(hero, /neon glow/, "no neon (owner 01.11)");
  assert.doesNotMatch(hero, /ВАЗЕЛИН|channel's host|references 2, 3, 4/, "no headline for GPT, no host even when his photos exist");
});
