// @ts-nocheck — выполняется в контейнере сайта, где рядом lib/carousel/sid/render
// Настоящая карта с пролётом к месту события (владелец 4.11 о роботакси: «сделай качественную карту, где видно названия,
// есть цвета, разделенная по штатам, городам везде и приближай туда где нужно, чтобы было название видно»).
// Векторные тайлы OpenFreeMap (стиль liberty, без ключа) рисует MapLibre в браузере сайта; подписи — по-русски (name:ru),
// где их нет — как в OSM. Камера летит от середины страны к месту, на месте — метка и подпись.
// Запускается В КОНТЕЙНЕРЕ САЙТА (браузер sidBrowser): runner/pipeline/mapfly.ts кладёт его туда как /app/tmp-mapfly.ts.
//   MAP='{"lat":32.7157,"lon":-117.1611,"label":"Сан-Диего","from":3.4,"to":12,"secs":2.8,"start":[39.5,-98.35]}' npx tsx tmp-mapfly.ts out.mp4
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sidBrowser, closeSidBrowser } from "./lib/carousel/sid/render";

type Spec = { lat: number; lon: number; label: string; from?: number; to?: number; secs?: number; start?: [number, number] };
const spec: Spec = JSON.parse(process.env.MAP ?? "{}");
const out = process.argv[2];
const FPS = 30;
const ease = (t: number) => t * t * (3 - 2 * t);

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet">
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>html,body,#m{margin:0;width:360px;height:640px;overflow:hidden}.maplibregl-ctrl-attrib{display:none}
#pin{position:absolute;left:180px;top:320px;transform:translate(-50%,-100%);opacity:0;transition:none;text-align:center;font:900 22px Montserrat,Arial,sans-serif}
#pin .t{display:inline-block;background:#141414;color:#fff;padding:7px 14px;border-radius:12px;margin-bottom:7px;white-space:nowrap}
#pin .d{width:24px;height:24px;margin:0 auto;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#E5484D;border:4px solid #fff;box-shadow:0 6px 14px rgba(0,0,0,.35)}</style>
</head><body><div id="m"></div><div id="pin"><div class="t"></div><div class="d"></div></div><script>
window.ready=false;
const map=new maplibregl.Map({container:'m',style:'https://tiles.openfreemap.org/styles/liberty',center:[0,0],zoom:2,interactive:false,attributionControl:false,fadeDuration:0});
map.on('load',()=>{for(const l of map.getStyle().layers){if(l.layout&&l.layout['text-field']!==undefined){map.setLayoutProperty(l.id,'text-field',['coalesce',['get','name:ru'],['get','name:latin'],['get','name']]);}}window.ready=true;});
window.go=(lon,lat,z)=>new Promise(r=>{map.jumpTo({center:[lon,lat],zoom:z});const done=()=>r(true);if(map.loaded()&&map.areTilesLoaded())setTimeout(done,30);else{map.once('idle',done);setTimeout(done,8000);}});
window.pin=(text,p)=>{const e=document.getElementById('pin');e.querySelector('.t').textContent=text;e.style.opacity=p;e.style.transform='translate(-50%,-100%) translateY('+(-20*(1-p))+'px)';};
</script></body></html>`;

void (async () => {
  const from = spec.from ?? 3.4;
  const to = spec.to ?? 12;
  const secs = spec.secs ?? 2.8;
  const start = spec.start ?? [spec.lat, spec.lon];
  const browser = await sidBrowser();
  // окно 360×640 при плотности 3: подписи карты в полтора раза крупнее, чем при 540×960
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.setContent(PAGE, { waitUntil: "load" });
  await page.waitForFunction("window.ready === true", null, { timeout: 60_000 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mapfly-"));
  const frames = Math.round(secs * FPS);
  const flyFrom = 0.15 * secs;
  const flyTo = 0.78 * secs;
  for (let i = 0; i < frames; i++) {
    const t = i / FPS;
    const k = ease(Math.min(1, Math.max(0, (t - flyFrom) / (flyTo - flyFrom))));
    const kc = ease(Math.min(1, k / 0.35));
    const lat = start[0] + (spec.lat - start[0]) * kc;
    const lon = start[1] + (spec.lon - start[1]) * kc;
    await page.evaluate(`window.go(${lon}, ${lat}, ${from + (to - from) * k - 0.585})`);
    const p = Math.min(1, Math.max(0, (t - (flyTo - 0.15)) / 0.3));
    await page.evaluate(`window.pin(${JSON.stringify(spec.label)}, ${p})`);
    fs.writeFileSync(path.join(dir, `${String(i).padStart(4, "0")}.png`), await page.screenshot({ type: "png" }));
  }
  await ctx.close();
  await closeSidBrowser();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", path.join(dir, "%04d.png"), "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", out]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`карта: ${spec.label}, ${frames} кадров`);
})();
