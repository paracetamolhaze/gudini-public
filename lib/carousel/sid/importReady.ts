import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import type { Slide } from "../types";
import { listCarousels, newId, slideFilePath, updateCarousel, writeFileAtomic } from "../store";
import { instagramImageProblems } from "../jpeg";
import { createSidCarousel } from "./create";
import { sidSlideHash } from "./hash";
import { addTopic } from "./topics";
import { SID_PALETTE } from "./palette";
import type { SidSource } from "./types";

/**
 * Готовые карусели формата, собранные вручную до раздела (одобрены владельцем 26–27.10), становятся
 * обычными записями раздела: слайды, подпись и источники — чтобы публиковать их с сайта.
 * Папка: 01.png … 09.png, caption.txt и meta.json {title, topicKey, palette, createdAt, sources}. Видео разделу не нужно.
 */

export type ReadyMeta = { title: string; topicKey: string; palette: number; createdAt: string; sources: SidSource[] };

export async function importReady(dir: string): Promise<{ id: string; created: boolean }> {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as ReadyMeta;
  const existing = listCarousels().find((c) => c.schema === 4 && c.sid?.imported && c.title === meta.title);
  if (existing) return { id: existing.id, created: false };
  const pngs = Array.from({ length: 9 }, (_, i) => path.join(dir, `${String(i + 1).padStart(2, "0")}.png`));
  const missing = pngs.filter((f) => !fs.existsSync(f));
  if (missing.length) throw new Error(`Нет слайдов: ${missing.map((f) => path.basename(f)).join(", ")}`);
  const colors = SID_PALETTE[meta.palette % SID_PALETTE.length];
  const c = createSidCarousel({ palette: meta.palette, accent: colors.accent, coverAccent: colors.cover, stage: "done", imported: true, sources: meta.sources }, new Date(meta.createdAt));
  const now = new Date().toISOString();
  const slides: Slide[] = [];
  for (let i = 0; i < pngs.length; i++) {
    const sid = newId("s");
    const jpeg = await sharp(fs.readFileSync(pngs[i])).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    const bad = instagramImageProblems(jpeg);
    if (bad.length) throw new Error(`Слайд ${i + 1}: ${bad.join(", ")}`);
    const file = `slide-${sid}-${crypto.createHash("sha1").update(jpeg).digest("hex").slice(0, 12)}.jpg`;
    writeFileAtomic(slideFilePath(c.id, file), jpeg);
    slides.push({ id: sid, kind: i === 0 ? "cover" : i === 8 ? "final" : "content", kicker: "", title: i === 0 ? meta.title : `Слайд ${i + 1}`, body: "", bullets: [], cta: "", render: { hash: sidSlideHash(sid), file, width: 1080, height: 1350, bytes: jpeg.length, at: now } });
  }
  const caption = fs.existsSync(path.join(dir, "caption.txt")) ? fs.readFileSync(path.join(dir, "caption.txt"), "utf8").replace(/\r/g, "").trim() : "";
  updateCarousel(c.id, (x) => {
    x.title = meta.title;
    x.slides = slides;
    x.caption = caption;
    x.hashtags = [];
  }, { content: true });
  addTopic({ key: meta.topicKey, title: meta.title, at: meta.createdAt, carouselId: c.id });
  return { id: c.id, created: true };
}
