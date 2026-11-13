import { test } from "node:test";
import assert from "node:assert/strict";
import { captionIssues, cleanSocialText, fitTitle, limitEmoji, normalizeMeta, sentences, socialCaption, stripHashtags } from "../lib/caption/text";
import { metaUser, writeMeta } from "../lib/caption/meta";

const chars = (...points: number[]) => String.fromCharCode(...points);
const EM_DASH = chars(0x2014);
const ZWSP = chars(0x200b);
const NBSP = chars(0xa0);
const GOOD = {
  title: "Что такое биткоин: объяснение на робуксах",
  description: "Деньги стоят чего-то, пока их нельзя напечатать по желанию. Какую игровую валюту ты бы сравнил с криптой?",
  hashtags: [],
};

test("типографика автора: дефис, ёлочки, три точки, без невидимых символов", () => {
  const raw = `Биткоин${ZWSP} ${EM_DASH} это${NBSP}робуксы ${chars(0x201c)}для взрослых${chars(0x201d)}${chars(0x2026)}`;
  assert.equal(cleanSocialText(raw), "Биткоин - это робуксы «для взрослых»...");
  assert.equal(cleanSocialText('Скажи "привет" и "пока"'), "Скажи «привет» и «пока»");
});

test("подпись без эмодзи и хэштегов", () => {
  assert.equal(limitEmoji("Плечо 🔥 съедает 🎥 депозит 🚀"), "Плечо съедает депозит");
  assert.equal(stripHashtags("Сид-фразу просит только вор #крипта\nТебе писали? #безопасность"), "Сид-фразу просит только вор\nТебе писали?");
});

test("заголовок обрезается по слову", () => {
  const long = "Почему рост сети Ethereum не гарантирует рост цены ETH и что на самом деле влияет на спрос";
  const fitted = fitTitle(long, 60);
  assert.ok(fitted.length <= 60);
  assert.ok(long.startsWith(fitted));
  assert.ok(!fitted.endsWith(" "));
});

test("ответ модели приводится к чистым полям, теги отбрасываются", () => {
  const meta = normalizeMeta({ title: `Тигр во дворе ${EM_DASH} что делать`, description: "🐅 Дикий зверь опасен не злостью, а страхом 🔥 Что бы ты сделал? #тигр #рек", hashtags: ["#безопасность"] } as never, "Тигр");
  assert.deepEqual(meta, { title: "Тигр во дворе - что делать", description: "Дикий зверь опасен не злостью, а страхом Что бы ты сделал?", hashtags: [] });
});

test("фразы считаются по знакам конца предложения", () => {
  assert.deepEqual(sentences("Плечо 50 - это ноль за 2%. Второму хватило 1%! Доверил бы ИИ?"), ["Плечо 50 - это ноль за 2%.", "Второму хватило 1%!", "Доверил бы ИИ?"]);
});

test("образец проходит, пересказ и шаблоны - нет", () => {
  assert.deepEqual(captionIssues(GOOD), []);
  const retold = captionIssues({
    title: "Клод трейдит за меня",
    description: "Дал Клоду кошелёк: лонг с плечом 50, падение на 2% - и ликвидация. Второму кошельку с плечом 100 хватило 1%. Ты бы доверил ИИ свои деньги?",
    hashtags: [],
  });
  assert.ok(retold.some((i) => i.startsWith("В подписи 3 фраз")));
  const stock = captionIssues({ title: "Стримить может каждый", description: "Начать стримить может каждый - подписывайся, будет ещё круче!", hashtags: [] });
  assert.ok(stock.some((i) => i.includes("«подписывайся»")));
  assert.ok(stock.some((i) => i.includes("«будет ещё круче»")));
  assert.ok(stock.some((i) => i.includes("вопросом")));
});

test("мораль должна закончиться до «ещё»", () => {
  const long = "Плечо превращает обычное колебание рынка, которое без него ты бы даже не заметил на графике, в полное обнуление счёта за минуты. Доверил бы?";
  assert.ok(captionIssues({ ...GOOD, description: long }).some((i) => i.startsWith("Первая фраза")));
});

test("шаблон ищется целыми словами", () => {
  assert.deepEqual(captionIssues({ ...GOOD, description: "Подписывать договор вслепую дорого. А ты читаешь, что подписываешь?" }), []);
});

test("подпись для Instagram и TikTok без заголовка YouTube, теги - только вписанные автором", () => {
  assert.equal(socialCaption(GOOD, "Тема"), GOOD.description);
  assert.equal(socialCaption({ title: "Заголовок", description: "Мысль. Вопрос?", hashtags: ["#а"] }, "Тема"), "Мысль. Вопрос?\n\n#а");
  assert.equal(socialCaption({ title: "Заголовок", description: "", hashtags: [] }, "Тема"), "Заголовок");
  assert.equal(socialCaption(undefined, "Тема"), "Тема");
});

test("второй проход получает свой вариант и поручения, остаётся лучший", async () => {
  const calls: string[] = [];
  const answers = [
    JSON.stringify({ title: "Первый стрим с нуля", description: "Первый стрим собрал троих зрителей. Двое были друзья. Подписывайся!" }),
    "```json\n" + JSON.stringify({ title: "Первый стрим с нуля", description: "Первый стрим нужен, чтобы перестать бояться второго. С чего начинал ты?" }) + "\n```",
  ];
  const meta = await writeMeta({ topic: "Стримы", script: "Сценарий", today: "Сегодня 2026-10-24." }, async (_system, user) => {
    calls.push(user);
    return answers.shift()!;
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /Твой вариант/);
  assert.match(calls[1], /В подписи 3 фраз/);
  assert.deepEqual(meta, { title: "Первый стрим с нуля", description: "Первый стрим нужен, чтобы перестать бояться второго. С чего начинал ты?", hashtags: [] });
});

test("ответ без JSON не становится подписью", async () => {
  const answers = ["Вот подпись: отличный ролик!", JSON.stringify({ title: "Сид-фраза", description: "Кто просит сид-фразу, тот уже забирает кошелёк. Тебе такие писали?" })];
  const meta = await writeMeta({ topic: "Сид-фраза", script: "", today: "" }, async () => answers.shift()!);
  assert.equal(meta.description, "Кто просит сид-фразу, тот уже забирает кошелёк. Тебе такие писали?");
});

test("справка идёт в запрос, без неё модель пишет только по сценарию", () => {
  assert.match(metaUser({ topic: "Т", script: "С", facts: ["Факт один"], today: "Д" }), /Проверенная справка:\nФакт один/);
  assert.match(metaUser({ topic: "Т", script: "С", today: "Д" }), /только то, что есть в сценарии/);
});
