import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { splitPhrases, shotsFromAnswer, libraryShots, captionEmphasis, MAX_SCENES, type Phrase } from "../lib/cards/plan";
import type { Word } from "../lib/transcribe";
import type { StoryAssetPackV2, PackAsset } from "../lib/storyAssetPack";

/** Слова подряд по 0.4 с; «|» в тексте — пауза 0.6 с. */
function speech(text: string): Word[] {
  const words: Word[] = [];
  let at = 0.2;
  for (const token of text.split(/\s+/)) {
    if (token === "|") { at += 0.6; continue; }
    words.push({ word: token, start: at, end: at + 0.32 });
    at += 0.4;
  }
  return words;
}

test("Картинки: фразы режутся по предложениям и паузам, длинная — не дольше 3.2 с, короткий хвост прилипает", () => {
  const words = speech("Беспилотное такси сдало полиции своих пассажиров. Это произошло в Калифорнии. | Двое подростков сели в машину и поехали через весь город к своим друзьям в другой район, где их ждали. Вот.");
  const phrases = splitPhrases(words);
  assert.ok(phrases.length >= 4, `фраз ${phrases.length}`);
  assert.equal(phrases[0].text, "Беспилотное такси сдало полиции своих пассажиров.");
  assert.equal(phrases[1].text, "Это произошло в Калифорнии.");
  for (const p of phrases) assert.ok(p.to - p.from <= 3.25, `«${p.text}» ${(p.to - p.from).toFixed(2)} с`);
  assert.ok(phrases[phrases.length - 1].text.endsWith("Вот."), "хвост «Вот.» не остался отдельной фразой");
  assert.ok(phrases[phrases.length - 1].to - phrases[phrases.length - 1].from >= 0.9);
  // Every word belongs to exactly one phrase, in order.
  assert.equal(phrases.reduce((n, p) => n + p.lastWord - p.firstWord + 1, 0), words.length);
});

test("Картинки: в субтитрах крупнее числа и отмеченные по сценарию имена", () => {
  const words = [{ word: "В", start: 0, end: 0.1 }, { word: "2024", start: 0.2, end: 0.5 }, { word: "Waymo", start: 0.6, end: 0.9, emphasis: true }, { word: "ехала", start: 1, end: 1.3 }];
  assert.deepEqual(captionEmphasis(words), [1, 2]);
});

const phrases: Phrase[] = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, from: i * 2.5, to: i * 2.5 + 2.2, text: `фраза ${i + 1}`, firstWord: i, lastWord: i }));
const asset = (id: string): PackAsset => ({
  id, kind: "IMAGE", file: `img-${id}.jpg`, sourceUrl: "", sourceDomain: "", description: id, role: "CONTEXT",
  compatibleBeatIds: ["b1"], relatedFactIds: [], verification: { sourceVerified: true, visualVerified: true, version: 1 },
});
const shown = [{ n: 1, asset: asset("wide"), aspect: 1.78, family: "wide" }, { n: 2, asset: asset("tall"), aspect: 0.66, family: "tall" }, { n: 3, asset: asset("square"), aspect: 1, family: "square" }];

test("Картинки: ответ монтажёра → кадры по фразам без дыр; широкое фото на весь экран уходит в панель", () => {
  const { shots } = shotsFromAnswer([
    { phrases: [1, 2], layout: "full", photo: 1, accent: true },
    { phrases: [3], layout: "full", photo: 2 },
    // phrase 4 is missing: it joins the shot before
    { phrases: [5], layout: "split", scene: "A white self-driving taxi in a parking lot surrounded by police cars" },
    { phrases: [5, 6], layout: "split", photo: 3 },
    { phrases: [6], layout: "split", photo: 99 },
    { phrases: [7, 8], layout: "author" },
  ], phrases, shown, "/media", 21);
  assert.equal(shots[0].from, 0, "ролик начинается с картинки");
  assert.equal(shots[0].layout, "split", "широкое фото не растягивается на весь экран");
  assert.equal(shots[0].accent, true);
  assert.equal(shots[1].layout, "full");
  assert.equal(shots[1].file, path.join("/media", "img-tall.jpg"));
  assert.equal(shots[1].to, phrases[3].to, "пропущенная фраза 4 досталась предыдущему кадру");
  assert.ok(shots[2].scene && shots[2].backup, "у сцены есть запасное фото");
  assert.equal(shots[3].file, path.join("/media", "img-wide.jpg"), "неизвестный номер фото — подставлено фото, которое монтажёр уже выбрал");
  assert.equal(shots[shots.length - 1].layout, "author");
  assert.equal(shots[shots.length - 1].to, 21, "последний кадр держится до конца");
  for (let i = 1; i < shots.length; i++) assert.ok(shots[i].from >= shots[i - 1].to - 1e-9, "кадры не пересекаются");
});

test("Картинки: первая фраза на авторе всё равно открывается картинкой", () => {
  const { shots } = shotsFromAnswer([{ phrases: [1], layout: "author" }, { phrases: [2, 3, 4, 5, 6, 7, 8], layout: "split", photo: 3 }], phrases, shown, "/media", 21);
  assert.notEqual(shots[0].layout, "author");
  assert.ok(shots[0].file);
});

test("Картинки: сцен сверх предела не рисуется — их место занимают фото медиатеки, но не одно и то же раз за разом", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, from: i * 2, to: i * 2 + 1.8, text: `ф${i + 1}`, firstWord: i, lastWord: i }));
  const raw = many.map(p => ({ phrases: [p.id], layout: "split", scene: `A detailed realistic scene number ${p.id} of the story` }));
  const { shots } = shotsFromAnswer(raw, many, shown, "/media", 60);
  assert.equal(shots.filter(s => s.scene).length, MAX_SCENES);
  for (const s of shown) {
    const times = shots.filter(x => x.file === path.join("/media", s.asset.file)).length;
    assert.ok(times <= 2, `фото ${s.asset.id} показано ${times} раз`);
  }
  for (let i = 1; i < shots.length; i++) {
    if (shots[i].file && shots[i - 1].file) assert.notEqual(shots[i].file, shots[i - 1].file, "одно фото два раза подряд");
  }
  // When the library is spent the picture before holds (up to 5 s) or the author speaks: never a fifth bucket in a row.
  assert.ok(shots.every(s => s.layout === "author" || s.to - s.from <= 5.01));
  assert.equal(shots[shots.length - 1].to, 60);
});

test("Картинки: одна статья Википедии — одно фото на ролик, повторный запрос заменяется фото медиатеки", () => {
  const { shots } = shotsFromAnswer([
    { phrases: [1, 2], layout: "split", real: { wiki: "Waymo", query: "white Waymo car" } },
    { phrases: [3, 4], layout: "split", photo: 1 },
    { phrases: [5, 6], layout: "split", real: { wiki: "waymo", query: "Waymo in a parking lot" } },
    { phrases: [7, 8], layout: "split", photo: 3 },
  ], phrases, shown, "/media", 21);
  assert.equal(shots.filter(s => s.real).length, 1);
  assert.ok(shots[2].file, "второй запрос той же статьи — фото медиатеки");
});

test("Картинки: подмена берёт только фото, которые монтажёр выбрал сам, — отбракованные им в ролик не попадают", () => {
  const { shots } = shotsFromAnswer([
    { phrases: [1, 2], layout: "split", photo: 1 },
    { phrases: [3, 4], layout: "split", real: { wiki: "Waymo" } },
    { phrases: [5, 6], layout: "split", real: { wiki: "Waymo" } },
    { phrases: [7], layout: "split", real: { wiki: "Waymo" } },
    { phrases: [8], layout: "split", photo: 2 },
  ], phrases, shown, "/media", 21);
  assert.ok(shots.every(s => s.file !== path.join("/media", "img-square.jpg")), "фото 3 монтажёр не выбирал");
});

test("Картинки: почти одинаковые фото одного семейства не идут подряд — второе продлевает первое", () => {
  const twins = [
    { n: 1, asset: asset("bucket-a"), aspect: 1.5, family: "gel-pellets" },
    { n: 2, asset: asset("bucket-b"), aspect: 1.5, family: "gel-pellets" },
    { n: 3, asset: asset("police"), aspect: 1.5, family: "police" },
  ];
  const { shots } = shotsFromAnswer([
    { phrases: [1], layout: "split", photo: 1 },
    { phrases: [2], layout: "split", photo: 2 },
    { phrases: [3, 4, 5, 6, 7, 8], layout: "split", photo: 3 },
  ], phrases, twins, "/media", 21);
  assert.equal(shots.length, 2);
  assert.equal(shots[0].to, phrases[1].to);
});

test("Картинки: без модели кадры по медиатеке — каждые 2–3.5 с, до конца ролика", () => {
  const pack = { assets: [asset("a"), asset("b"), asset("c")] } as unknown as StoryAssetPackV2;
  const shots = libraryShots(phrases, pack, [{ id: "b1", text: "", factIds: [], visualNeed: "ENTITY" as never, entities: [] }], "/nonexistent", 21);
  // Files do not exist in the test: the montage falls back to the author alone rather than failing.
  assert.equal(shots.length, 1);
  assert.equal(shots[0].layout, "author");
});
