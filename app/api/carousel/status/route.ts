import { threadsAccountInfo } from "@/lib/carousel/threads";
import { NextRequest } from "next/server";
import { guard, ok } from "@/lib/carousel/http";
import { instagramAccountInfo, listInstagramAccounts } from "@/lib/carousel/account";
import { DECK_LIMITS, IG_LIMITS } from "@/lib/carousel/limits";
import { runnerState } from "@/lib/carousel/runnerControl";
import { budgetLimits, carouselApiKey, configProblems, defaultImageModel, imageResolution, KEY_ENV, imageTransport, writerConfigProblems, writerModel } from "@/lib/carousel/config";
import { IMAGE_MODELS, IMAGE_MODEL_IDS, MODELS_CHECKED_AT, imageEstimate, requestResolution, textEstimate } from "@/lib/carousel/models";
import { keyInfo, modelCatalog, redactSecrets, type KeyInfo } from "@/lib/carousel/openrouter";
import { budgetStatus } from "@/lib/carousel/spend";
import { readDesign } from "@/lib/carousel/design";
import { COMMON_TIME_ZONES, DEFAULT_TIME_ZONE } from "@/lib/carousel/timezone";

export const dynamic = "force-dynamic";

/** Лимит ключа читается не чаще раза в минуту: это запрос к OpenRouter на каждый показ страницы. */
let keyCache: { at: number; value: KeyInfo | null; error: string | null } | null = null;

async function keyState(): Promise<{ info: KeyInfo | null; error: string | null }> {
  if (imageTransport() === "codex" || !carouselApiKey()) return { info: null, error: null };
  if (keyCache && Date.now() - keyCache.at < 60_000) return { info: keyCache.value, error: keyCache.error };
  try {
    const value = await keyInfo();
    keyCache = { at: Date.now(), value, error: null };
    return { info: value, error: null };
  } catch (e: any) {
    const error = redactSecrets(String(e?.message ?? e)).slice(0, 200);
    keyCache = { at: Date.now(), value: null, error };
    return { info: null, error };
  }
}

/** Доступность моделей по публичному каталогу OpenRouter: нет в каталоге или нет нужного соотношения — недоступна, подмены нет. */
async function modelAvailability() {
  if (imageTransport() === "codex") { const m = IMAGE_MODELS["codex/imagegen"]; return [{ ...m, available: true, reason: null, resolution: null, perImageUsd: 0 }]; }
  let catalog: Awaited<ReturnType<typeof modelCatalog>> | null = null;
  let catalogError: string | null = null;
  try {
    catalog = await modelCatalog("images");
  } catch (e: any) {
    catalogError = redactSecrets(String(e?.message ?? e)).slice(0, 160);
  }
  return IMAGE_MODEL_IDS.filter(id => id !== "codex/imagegen").map((id) => {
    const m = IMAGE_MODELS[id];
    let available: boolean | null = null;
    let reason: string | null = null;
    if (catalog) {
      const entry = catalog.get(id);
      if (!entry) {
        available = false;
        reason = "модели сейчас нет в каталоге OpenRouter";
      } else {
        const aspects: unknown[] = entry.params?.aspect_ratio?.values ?? [];
        const need = m.aspect.portrait;
        if (aspects.length && !aspects.includes(need)) {
          available = false;
          reason = `модель не принимает соотношение ${need}`;
        } else available = true;
      }
    } else reason = `каталог OpenRouter недоступен: ${catalogError}`;
    const resolution = requestResolution(id, imageResolution());
    return { ...m, available, reason, resolution, perImageUsd: imageEstimate(id, resolution) };
  });
}

/** Что доступно разделу: ключ (только «задан / не задан»), модели, бюджет, Instagram, оформление. Значений секретов нет. */
export async function GET(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  const [key, models, threads] = await Promise.all([keyState(), modelAvailability(), threadsAccountInfo()]);
  const ig = instagramAccountInfo();
  const text = writerModel();
  const image = defaultImageModel();
  return ok({
    config: { imageTransport: imageTransport(), textProblems: writerConfigProblems(), textBilling: "subscription", keyEnv: KEY_ENV, keySet: Boolean(carouselApiKey()), problems: configProblems(), textModel: text.id, imageModel: image.id, resolution: imageTransport() === "codex" ? "авто" : imageResolution(), budgets: budgetLimits() },
    key: key.info,
    keyError: key.error,
    models,
    modelsCheckedAt: MODELS_CHECKED_AT,
    pricing: { textPlanUsd: textEstimate(text.id, "plan") * 1.5, textEditUsd: textEstimate(text.id, "edit") },
    budget: budgetStatus(),
    instagram: { connected: ig.connected, label: ig.label, via: ig.via, expiresInDays: ig.expiresInDays, problems: ig.problems, accounts: listInstagramAccounts().map(a => ({ ...a, problems: instagramAccountInfo(a.id).problems })) },
    threads,
    design: readDesign(),
    timeZone: DEFAULT_TIME_ZONE,
    timeZones: COMMON_TIME_ZONES,
    limits: { slides: { min: DECK_LIMITS.minSlides, max: DECK_LIMITS.maxSlides, default: DECK_LIMITS.defaultSlides }, ig: IG_LIMITS },
    runner: runnerState(),
  });
}
