import fs from "fs";
import http from "node:http";
import https from "node:https";
import path from "path";
import sharp from "sharp";
import { getSettings, FACE_FILE, hasFace } from "./store";
import { runFfmpeg } from "./ffmpeg";
import { computeLayout, buildCoverHeadlineAss, resolveCoverFontFile } from "./coverLayout";
import type { CoverConcept } from "./cover";
import { assertProvider } from "./providerPolicy";
import { assertBudget, IMAGE_PRICES, recordFlat } from "./costLedger";

/**
 * Рисует обложку GPT через мост Codex (подписка, $0) — решение владельца 07.11: «обложки должен делать гпт».
 * Тот же промпт и то же лицо-образец, что и раньше. Gemini Flash через OpenRouter (платно, ~$0.07) —
 * только запасной путь, когда мост не ответил; FULL_AI_COVER_PROVIDER=openrouter вернёт его основным.
 */

export const DEFAULT_FULL_AI_MODEL = "google/gemini-3.1-flash-image";

/**
 * Выключатель обложек: FULL_AI_COVER=false — обложки не генерируются вовсе.
 * Это НЕ переключение на другой способ: подменных обложек в системе не существует.
 */
export const fullAiCoverEnabled = () => process.env.FULL_AI_COVER !== "false";
export const fullAiCoverModel = () => process.env.FULL_AI_COVER_MODEL || DEFAULT_FULL_AI_MODEL;

export type GeneratedImage = { file: string; cost: number; width: number; height: number; provider?: string };

export const GPT_COVER_PROVIDER = "gpt (мост Codex)";

/** Картинка от GPT через мост: POST /image с лицом-образцом, ответ — base64. Очередь моста общая, ждём долго. */
function bridgeImage(prompt: string, reference: string): Promise<Buffer> {
  const base = process.env.CODEX_IMAGE_BRIDGE_URL || process.env.CODEX_BRIDGE_URL;
  const token = process.env.CODEX_BRIDGE_TOKEN;
  if (!base || !token) return Promise.reject(new Error("BRIDGE_NOT_CONFIGURED"));
  const url = new URL("/image", base);
  const body = JSON.stringify({ prompt, aspectRatio: "9:16", references: [reference], mode: "generate" });
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${token}` },
    }, res => {
      const chunks: Buffer[] = [];
      res.on("data", c => chunks.push(c));
      res.on("error", e => { clearTimeout(timer); reject(e); });
      res.on("end", () => {
        clearTimeout(timer);
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (res.statusCode !== 200 || typeof data.base64 !== "string") reject(new Error(`BRIDGE_IMAGE_ERROR: ${res.statusCode} ${String(data.error ?? "").slice(0, 160)}`));
          else resolve(Buffer.from(data.base64, "base64"));
        } catch { reject(new Error("BRIDGE_IMAGE_ERROR: некорректный ответ моста")); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error("BRIDGE_IMAGE_TIMEOUT")), 30 * 60 * 1000);
    req.on("error", e => { clearTimeout(timer); reject(e); });
    req.end(body);
  });
}

/** Одна обложка: GPT через мост, при его сбое — Gemini через OpenRouter. */
export async function generateCoverImage(prompt: string, outFile: string): Promise<GeneratedImage> {
  if (!hasFace()) throw new Error("NO_REFERENCE");
  if (process.env.FULL_AI_COVER_PROVIDER !== "openrouter") {
    try {
      const face = await sharp(fs.readFileSync(FACE_FILE)).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer();
      const buffer = await bridgeImage(prompt, `data:image/jpeg;base64,${face.toString("base64")}`);
      const meta = await sharp(buffer).metadata();
      if (!meta.width || !meta.height || meta.width < 256 || meta.height < 256) throw new Error("BRIDGE_IMAGE_ERROR: картинка не читается");
      fs.writeFileSync(outFile, buffer);
      recordFlat({ stage: "Cover Generation", provider: "codex", model: "gpt-image (подписка)", cost: 0, estimated: false });
      return { file: outFile, cost: 0, width: meta.width, height: meta.height, provider: GPT_COVER_PROVIDER };
    } catch (e: any) {
      console.warn(`Cover: мост GPT не дал обложку (${String(e?.message ?? e).slice(0, 160)}) — рисует запасной Gemini`);
    }
  }
  return generateOpenRouterCover(prompt, outFile);
}

/** Запасной путь: Gemini Flash через OpenRouter с reference-лицом из Настроек (платно). */
async function generateOpenRouterCover(prompt: string, outFile: string): Promise<GeneratedImage> {
  // OpenRouter разрешён только обложке — проверяем до платного запроса
  assertProvider("Cover Generation", "openrouter");
  assertBudget("Cover Generation", IMAGE_PRICES["google/gemini-3.1-flash-image"] ?? 0.07);
  const key = getSettings().openrouterKey;
  if (!key) throw new Error("NO_OPENROUTER_KEY");
  if (!hasFace()) throw new Error("NO_REFERENCE");

  const faceB64 = fs.readFileSync(FACE_FILE).toString("base64");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: fullAiCoverModel(),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${faceB64}` } },
          ],
        },
      ],
      modalities: ["image", "text"],
      usage: { include: true },
    }),
  });
  const json: any = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`IMAGE_PROVIDER_ERROR: ${res.status} ${JSON.stringify(json.error ?? {}).slice(0, 200)}`);
  }
  const dataUrl: string | undefined = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl?.startsWith("data:")) throw new Error("IMAGE_PROVIDER_ERROR: изображение не вернулось");
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  fs.writeFileSync(outFile, buffer);
  // Цена картинки — в леджер прогона: без этой записи обложка не попадала в журнал
  // расходов, и полная стоимость ролика оказывалась занижена на $0.03–0.07.
  const reported = Number(json.usage?.cost);
  recordFlat({
    stage: "Cover Generation",
    provider: "openrouter",
    model: fullAiCoverModel(),
    cost: Number.isFinite(reported) && reported > 0 ? reported : (IMAGE_PRICES["google/gemini-3.1-flash-image"] ?? 0.07),
    estimated: !(Number.isFinite(reported) && reported > 0),
  });
  return { file: outFile, cost: Number.isFinite(reported) ? reported : 0, width: 0, height: 0, provider: fullAiCoverModel() };
}

/**
 * Lossless-приведение к формату обложки 1080×1920 + мягкий photographic finishing.
 * Тот же фильтр, что и в текущем production-пайплайне (единый вид обложек).
 */
export async function finishCoverImage(dir: string, source: string, out: string): Promise<string> {
  await runFfmpeg(
    [
      "-i", path.basename(source),
      "-vf",
      "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920," +
        "unsharp=5:5:0.55:5:5:0.0,eq=contrast=1.03:saturation=1.02",
      "-frames:v", "1",
      path.basename(out),
    ],
    { cwd: dir },
  );
  return out;
}

/** Детерминированный текстовый слой поверх чистой картинки (режим RENDERER_TEXT и фолбэк). */
export async function renderHeadlineOnImage(
  dir: string,
  baseImage: string,
  concept: CoverConcept,
  out: string,
): Promise<string> {
  const layout = computeLayout(concept.headlineLines);
  fs.writeFileSync(path.join(dir, "cover-text.ass"), buildCoverHeadlineAss(layout, concept.kicker), "utf8");
  fs.mkdirSync(path.join(dir, "fonts"), { recursive: true });
  const font = resolveCoverFontFile();
  fs.copyFileSync(font.file, path.join(dir, "fonts", path.basename(font.file)));
  await runFfmpeg(
    [
      "-i", path.basename(baseImage),
      "-vf", "ass=cover-text.ass:fontsdir=fonts",
      "-frames:v", "1",
      "-q:v", "1",
      path.basename(out),
    ],
    { cwd: dir },
  );
  return out;
}

/** Финальный энкод обложки без текстового слоя (режим FULL_AI — буквы уже нарисованы). */
export async function encodeFinalCover(dir: string, baseImage: string, out: string): Promise<string> {
  await runFfmpeg(
    ["-i", path.basename(baseImage), "-frames:v", "1", "-q:v", "1", path.basename(out)],
    { cwd: dir },
  );
  return out;
}
