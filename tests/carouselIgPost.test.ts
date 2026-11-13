import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

/**
 * Владелец заливает карусели с телефона (02.11): карусель узнаёт свой пост в статистике по началу подписи,
 * показывает просмотры и охват; не нашёлся — отметку «Опубликована» ставят кнопкой.
 */

const CAPTION = "Высокий суд Лондона решил: права жертв на 61 000 BTC оценивают по китайскому праву. На следующий день суд в Тяньцзине опубликовал уведомление.\nКому, по-твоему, должны достаться монеты? Пиши в комментариях.";

test("пост находится по началу подписи, хвост и регистр не мешают", async () => {
  const { captionKey, findPost } = await import("../lib/carousel/igPost");
  assert.equal(captionKey("  Ёлки: «Binance» —  взлом!\nвторая строка"), "елки binance взлом");
  const posts = [
    { url: "https://www.instagram.com/p/A/", title: "Высокий суд Лондона решил: права жертв на 61 000 BTC оценивают по китайскому праву. На следующий день суд в Тяньцзине опубликовал", publishedAt: "2026-11-02T08:00:00.000Z", carousel: true, views: 2074, reach: 979 },
    { url: "https://www.instagram.com/p/B/", title: "Совсем другой пост про биткоин и суды Лондона", publishedAt: "2026-11-02T09:00:00.000Z", carousel: true, views: 10, reach: 5 },
  ];
  assert.equal(findPost(CAPTION, posts)?.url, "https://www.instagram.com/p/A/");
  // владелец поправил хвост подписи на телефоне: первые 60 знаков те же
  assert.equal(findPost(CAPTION.replace("На следующий день суд в Тяньцзине", "Назавтра суд Тяньцзиня"), posts)?.url, "https://www.instagram.com/p/A/");
  assert.equal(findPost("Короткая подпись?", posts), null, "слишком короткое начало не сравнивается");
  assert.equal(findPost("Tether отчиталась о $1,5 млрд операционной прибыли за III квартал", posts), null);
});

test("опубликована: пост из статистики важнее ручной отметки, без поста — ручная отметка", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-igpost-"));
  process.env.CAROUSEL_STATS_DIR = dir;
  const { publicationOf, readIgPosts } = await import("../lib/carousel/igPost");
  assert.deepEqual(readIgPosts(), [], "нет файла статистики — пустой список");
  assert.equal(publicationOf({ caption: CAPTION }), null);
  assert.deepEqual(publicationOf({ caption: CAPTION, manualPublishedAt: "2026-11-02T10:00:00.000Z" }), { at: "2026-11-02T10:00:00.000Z", source: "manual" });
  fs.writeFileSync(path.join(dir, "posts-instagram.json"), JSON.stringify({ updatedAt: "2026-11-02T11:00:00.000Z", posts: {
    "instagram:1:1": { url: "https://www.instagram.com/p/A/", title: CAPTION.split("\n")[0].slice(0, 160), publishedAt: "2026-11-02T08:00:00.000Z", mediaType: "CAROUSEL_ALBUM", metrics: { views: 2074, reach: 979 } },
    "instagram:1:2": { url: "https://www.instagram.com/reel/R/", title: "Ролик без подписи карусели", publishedAt: "2026-11-02T09:00:00.000Z", mediaType: "VIDEO", metrics: { views: 5 } },
  } }));
  assert.deepEqual(publicationOf({ caption: CAPTION, manualPublishedAt: "2026-11-02T10:00:00.000Z" }), { at: "2026-11-02T08:00:00.000Z", source: "post", url: "https://www.instagram.com/p/A/", views: 2074, reach: 979 });
});

test("кнопка «Опубликована» ставит отметку с датой, повторное нажатие снимает", async () => {
  process.env.CAROUSEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-igpost-data-"));
  process.env.CAROUSEL_STATS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-igpost-empty-"));
  process.env.SITE_PASSWORD = "pw";
  const auth = await import("../lib/carousel/auth");
  const { createSidCarousel } = await import("../lib/carousel/sid/create");
  const { POST } = await import("../app/api/carousel/[id]/published/route");
  const c = createSidCarousel({ style: "urgent" });
  const call = async (published: unknown) => {
    const req = new NextRequest(new URL(`/api/carousel/${c.id}/published`, "http://localhost:3000"), { method: "POST", headers: { cookie: `gudini_auth=${auth.authCookieValue("pw")}`, "content-type": "application/json" }, body: JSON.stringify({ published }) });
    const res = await POST(req, { params: Promise.resolve({ id: c.id }) });
    return { status: res.status, body: await res.json() };
  };
  const on = await call(true);
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.publication.source, "manual");
  assert.ok(Date.now() - Date.parse(on.body.publication.at) < 60_000);
  const off = await call(false);
  assert.equal(off.body.publication, null);
  assert.equal((await call("да")).status, 400);
});
