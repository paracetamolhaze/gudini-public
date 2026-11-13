// Карта с подлётом к месту события для «Новостей»: MapLibre + OpenFreeMap рисует браузер сайта (runner/map/mapfly-site.ts
// запускается в контейнере gudini-site), готовый клип 1080×1920 ложится в public/maps задания. Прежняя карта — контур
// страны на плоской карте мира — была без городов и подписей (владелец 5.11: «почему карта старая? мы же делали новую»).
import fs from "node:fs";
import path from "node:path";
import { NEWS_ROOT, run } from "./util";

const CONTAINER = process.env.GUDINI_SITE_CONTAINER || "gudini-site";
/** Длина клипа карты: пролёт и полсекунды на метку с подписью. */
export const MAP_FLY_SECONDS = 3.2;

export type MapFlySpec = { lat: number; lon: number; label: string; zoom?: number };

/** Клип карты; путь относительно public задания или null, если браузер сайта недоступен. */
export async function renderMapFly(pub: string, spec: MapFlySpec, signal?: AbortSignal): Promise<string | null> {
  const slug = `map_${Math.round(spec.lat * 1000)}_${Math.round(spec.lon * 1000)}`;
  const rel = `maps/${slug}.mp4`;
  const out = path.join(pub, rel);
  if (fs.existsSync(out)) return rel;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const to = spec.zoom ?? 10.6;
  const map = JSON.stringify({ lat: spec.lat, lon: spec.lon, label: spec.label, from: Math.max(3.2, to - 6), to, secs: MAP_FLY_SECONDS });
  try {
    await run("docker", ["cp", path.join(NEWS_ROOT, "runner", "map", "mapfly-site.ts"), `${CONTAINER}:/app/tmp-mapfly.ts`], { timeoutMs: 60_000, signal });
    await run("docker", ["exec", "-e", `MAP=${map}`, "-w", "/app", CONTAINER, "npx", "tsx", "tmp-mapfly.ts", `/app/tmp-maps/${slug}.mp4`], { timeoutMs: 300_000, signal });
    await run("docker", ["cp", `${CONTAINER}:/app/tmp-maps/${slug}.mp4`, out], { timeoutMs: 60_000, signal });
  } catch {
    return null;
  }
  return fs.existsSync(out) ? rel : null;
}
