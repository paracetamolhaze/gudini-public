import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import sharp from "sharp";

/**
 * Конвейер «Создать» целиком, без сети: поддельные мосты Claude и картинок Codex и страницы-источники на
 * локальном сервере, настоящий Chromium и вёрстка. Проверяется, что карусель собирается из 9 слайдов и что
 * видео больше нет: ни шага «ролик», ни video.mp4, ни кадров для него (владелец 28.10: «видео не нужно»).
 * Нужны Chromium Playwright и шрифты Liberation — в образе сайта они есть; без них тест пропускается.
 */

const hasFonts = fs.existsSync("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf") || Boolean(process.env.CAROUSEL_SID_FONT_DIR);

let server: http.Server;
let base = "";
const calls: string[] = [];

const article = (n: number) => `<!doctype html><html><head><meta charset="utf-8"><title>Статья ${n}</title><meta property="og:title" content="Headline number ${n} about the case"></head>
<body style="font-family:sans-serif;margin:0;padding:40px;width:820px"><p>News · Crypto</p><h1 style="font-size:40px;line-height:1.2">Headline number ${n} about the case</h1>
<p>${"A long paragraph with verifiable facts about the story, numbers and dates. ".repeat(12)}</p><p>${"More text of the article so the page is not empty. ".repeat(10)}</p></body></html>`;

function research() {
  const facts = Array.from({ length: 9 }, (_, i) => ({ id: `f${i + 1}`, claim: `Факт ${i + 1}`, quote: `Quote ${i + 1}`, url: `${base}/a${(i % 7) + 1}`, publisher: `Изд${(i % 7) + 1}`, date: "2026-10-27" }));
  const pages = Array.from({ length: 7 }, (_, i) => ({ step: i + 1, url: `${base}/a${i + 1}`, publisher: `Изд${i + 1}`, headline: `Headline number ${i + 1}` }));
  return { topic: "Тестовая история", topicKey: "test-story", angle: "что известно и что скрывают", facts, pages };
}

function content() {
  const steps = Array.from({ length: 7 }, (_, i) => ({
    icon: "doc",
    label: `Изд${i + 1} · 27 октября`,
    title: `Шаг номер ${i + 1}.`,
    body: `Короткий текст шага ${i + 1}: **$${i + 1} млн** и **${i + 2} кошелька**.`,
    pills: [["СУММА", `$${i + 1} млн`], ["ДАТА", `${20 + i} октября`]],
    next: i === 6 ? "сохрани" : "дальше",
    source: i,
    facts: [`f${i + 1}`],
  }));
  return {
    topic: "Тестовая история",
    topicKey: "test-story",
    cover: { pill: "СРОЧНО", title: ["ТЕСТ", "КОНВЕЙЕРА."], accentLine: "БЕЗ ВИДЕО.", hook: "Что известно и что скрывают →", scene: "A dark room with a laptop." },
    steps,
    final: { black: ["СОХРАНИ", "И ПЕРЕШЛИ ДРУГУ."], accent: ["ЧТО ДАЛЬШЕ?"], cards: [["$", "7 млн", "всего"], ["7", "шагов", "истории"], ["27", "октября", "дата"]], body: "Как думаешь, что дальше? Пиши в комментариях." },
    caption: "Тестовая история в семь шагов.\nКак думаешь, что дальше? Пиши в комментариях.",
    sources: Array.from({ length: 7 }, (_, i) => ({ url: `${base}/a${i + 1}`, title: `Headline number ${i + 1}`, publisher: `Изд${i + 1}`, date: "2026-10-27" })),
  };
}

before(async () => {
  const png = await sharp({ create: { width: 1122, height: 1402, channels: 3, background: "#202020" } }).png().toBuffer();
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const send = (body: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "GET" && /^\/a\d$/.test(req.url ?? "")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(article(Number(req.url!.slice(2))));
      }
      if (req.url === "/image") {
        calls.push("image");
        return send({ base64: png.toString("base64"), mediaType: "image/png", runId: "r1", billing: "subscription" });
      }
      if (req.url === "/complete") {
        const job = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        calls.push(job.label);
        if (/тема и факты/.test(job.label)) return send({ text: JSON.stringify(research()) });
        if (/тексты/.test(job.label)) return send({ text: "```json\n" + JSON.stringify(content()) + "\n```" });
        if (/проверка фактов/.test(job.label)) return send({ text: JSON.stringify({ content: content(), changes: [], unsupported: [] }) });
        if (/обложки/.test(job.label)) return send({ text: '{"text": false, "face": false, "realPerson": false, "note": "чисто"}' });
        return send({ text: JSON.stringify({ content: content() }) });
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.CAROUSEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-sid-pipeline-"));
  process.env.CAROUSEL_CLAUDE_URL = base;
  process.env.CLAUDE_BRIDGE_TOKEN = "t".repeat(40);
  process.env.CODEX_IMAGE_BRIDGE_URL = base;
  process.env.CODEX_BRIDGE_TOKEN = "codex-test";
});

after(() => server?.close());

test("«Создать»: конвейер собирает 9 слайдов без видео — ни шага ролика, ни video.mp4, ни кадров для него", { skip: hasFonts ? false : "нет шрифтов Liberation — тест идёт в образе сайта", timeout: 240_000 }, async () => {
  const { createSidCarousel } = await import("../lib/carousel/sid/create");
  const { attachJob, getCarousel, slideFilePath, updateCarousel } = await import("../lib/carousel/store");
  const { runSid } = await import("../lib/carousel/sid/pipeline");
  const { sidDir } = await import("../lib/carousel/sid/paths");
  const { readTopics } = await import("../lib/carousel/sid/topics");
  const created = createSidCarousel();
  const c0 = updateCarousel(created.id, (x) => {
    attachJob(x, "generate");
  });
  const steps: string[] = [];
  const note = await runSid(created.id, c0.job!, (text) => steps.push(text));
  const c = getCarousel(created.id)!;
  assert.match(note ?? "", /Карусель готова/);
  assert.equal(c.sid!.stage, "done");
  assert.equal(c.slides.length, 9);
  for (const s of c.slides) assert.ok(fs.existsSync(slideFilePath(c.id, s.render!.file!)), `нет файла слайда ${s.id}`);
  const meta = await sharp(fs.readFileSync(slideFilePath(c.id, c.slides[0].render!.file!))).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1080, 1350, "jpeg"]);
  // видео нет нигде
  assert.equal(c.sid!.video, undefined);
  const files = fs.readdirSync(sidDir(c.id));
  assert.ok(!files.some((f) => f === "video.mp4" || /^reel-/.test(f)), `в папке карусели остались файлы ролика: ${files.join(", ")}`);
  assert.ok(!steps.some((t) => /ролик|reels|видео/i.test(t)), `шаги: ${steps.join(" | ")}`);
  // все 7 окон сняты со своих страниц, подпись и тема записаны
  assert.equal(c.sid!.shots!.filter((s) => s?.kind === "page").length, 7);
  assert.equal(new Set(c.sid!.shots!.map((s) => s!.url)).size, 7);
  assert.match(c.caption, /Пиши в комментариях/);
  assert.ok(readTopics().some((t) => t.key === "test-story" && t.carouselId === c.id));
  assert.deepEqual(calls.filter((x) => x === "image").length, 1);
});
