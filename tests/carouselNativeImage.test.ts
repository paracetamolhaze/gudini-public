import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { makePng } from "./carouselPng";
import { validateNativeImageRequest, readNativeOutput, normalizeNativeReference } from "../lib/codexImage";
import sharp from "sharp";
import { createCarousel, updateCarousel, newId, getCarousel } from "../lib/carousel/store";
import { generateSlideImage } from "../lib/carousel/images";
import { readSpend } from "../lib/carousel/spend";
import { setOpenRouterFetch } from "../lib/carousel/openrouter";

test("reference conversion preserves geometry and colour, rejects truncated raster data before generation", async () => {
  const input = makePng(300, 400, 1);
  const output = await normalizeNativeReference(input);
  const info = await sharp(output).metadata();
  assert.equal(info.format, 'jpeg');
  assert.equal(info.width, 300); assert.equal(info.height, 400);
  const actual = await sharp(output).removeAlpha().raw().toBuffer();
  const expected = await sharp(input).flatten({ background: '#ffffff' }).raw().toBuffer();
  assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= 5));
  assert.ok(actual.reduce((sum, value, index) => sum + Math.abs(value - expected[index]), 0) / actual.length < 1);
  await assert.rejects(normalizeNativeReference(input.subarray(0, 30)));
});

test("native image output must be a fresh image in this run; requests reject URLs and bad edits", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-output-"));
  const image = path.join(dir, "image.png"); fs.writeFileSync(image, makePng(300, 400, 1));
  const allowed = path.join(dir, "allowed"); fs.mkdirSync(allowed);
  try {
    assert.throws(() => readNativeOutput(image, [allowed], Date.now()), /вне каталога/);
    assert.equal(readNativeOutput(image, [dir], Date.now()).mediaType, "image/png");
    assert.throws(() => readNativeOutput(image, [dir], Date.now() + 10000), /некорректный файл/);
    assert.throws(() => validateNativeImageRequest({ prompt: "p", aspectRatio: "4:5", references: ["http://localhost/secret"], mode: "generate" }));
    assert.throws(() => validateNativeImageRequest({ prompt: "p", aspectRatio: "4:5", references: [], mode: "edit" }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("site native images: generate/edit versions and references, subscription without key/budget, no fallback", async () => {
  const saved = { ...process.env };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "carousel-native-"));
  process.env.CAROUSEL_DATA_DIR = root;
  process.env.CAROUSEL_IMAGE_TRANSPORT = "codex";
  process.env.CAROUSEL_MONTHLY_BUDGET_USD = "0";
  process.env.CAROUSEL_MAX_COST_PER_CAROUSEL_USD = "0";
  process.env.CODEX_BRIDGE_TOKEN = "test-token";
  delete process.env.CAROUSEL_OPENROUTER_API_KEY;
  let paid = 0; setOpenRouterFetch(async () => { paid++; throw Error("paid API called"); });
  const requests: any[] = []; let fail = false;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.equal(req.url, "/image"); requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.statusCode = fail ? 502 : 200; res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(fail ? { error: "Лимит подписки" } : { base64: makePng(300, 400, 1).toString("base64"), mediaType: "image/png", runId: "native-test", billing: "subscription" }));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  process.env.CODEX_BRIDGE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const c = createCarousel({ idea: "Стол для съёмки", wishes: "", slideCount: 3, language: "ru", format: "portrait", style: "graphite" }, { mode: "illustrated", imageModel: "google/gemini-3.1-flash-image" });
    const sid = newId("s");
    updateCarousel(c.id, x => { x.slides = [{ id: sid, kind: "cover", title: "Стол", kicker: "", body: "", bullets: [], cta: "", image: { brief: "A tidy desk", composition: "Space below", textPlacement: "bottom", versions: [], rev: 1, attempts: 0, status: "none" } }]; });
    assert.equal((await generateSlideImage(c.id, "j1", sid, { mode: "generate" })).ok, true);
    assert.equal((await generateSlideImage(c.id, "j2", sid, { mode: "edit", instruction: "Make warmer" })).ok, true);
    assert.equal(requests[0].mode, "generate"); assert.equal(requests[1].mode, "edit");
    assert.ok(requests[1].references[0].startsWith("data:image/png;base64,"));
    const versions = getCarousel(c.id)!.slides[0].image!.versions;
    assert.equal(versions.length, 2); assert.ok(versions.every(v => v.model === "codex/imagegen" && v.cost === 0));
    assert.ok(readSpend().every(e => e.billing === "subscription" && e.cost === 0));
    fail = true; assert.equal((await generateSlideImage(c.id, "j3", sid, { mode: "generate" })).ok, false);
    assert.equal(requests.length, 3); assert.equal(paid, 0);
    assert.equal(getCarousel(c.id)!.slides[0].image!.versions.length, 2);
  } finally {
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); setOpenRouterFetch(null);
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

