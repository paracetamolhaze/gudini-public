import fs from "fs";
import path from "path";
import type { Carousel } from "../types";
import { carouselDir, emptyPublish, listCarousels, newId, writeFileAtomic } from "../store";
import { nextPaletteIndex, SID_PALETTE } from "./palette";
import type { SidData } from "./types";

/** Пустая карусель формата раздела со своим акцентным цветом; тема появится, когда Claude её найдёт. */
export function createSidCarousel(extra: Partial<SidData> = {}, now = new Date()): Carousel {
  const recent = listCarousels().filter((c) => c.schema === 4 && c.sid).map((c) => c.sid!.palette);
  const palette = extra.palette ?? nextPaletteIndex(recent);
  const colors = SID_PALETTE[palette % SID_PALETTE.length];
  const id = newId("c");
  const at = now.toISOString();
  const c: Carousel = {
    id,
    schema: 4,
    createdAt: at,
    updatedAt: at,
    revision: 1,
    title: "Новая карусель",
    request: { idea: "", wishes: "", slideCount: 9, language: "ru", style: "paper", format: "portrait" },
    style: "paper",
    format: "portrait",
    language: "ru",
    footer: "",
    story: [],
    slides: [],
    caption: "",
    hashtags: [],
    claimsToCheck: [],
    mode: "text_cards",
    job: null,
    publish: emptyPublish(),
    cost: { usd: 0, calls: 0 },
    sid: { v: 1, accent: colors.accent, coverAccent: colors.cover, stage: "research", ...extra, palette },
  };
  fs.mkdirSync(carouselDir(id), { recursive: true });
  writeFileAtomic(path.join(carouselDir(id), "carousel.json"), JSON.stringify(c, null, 2));
  return c;
}
