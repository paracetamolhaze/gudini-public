// Звуки (news/sounds/<роль>, скопированы из Астры) и музыка (news/music) — подготовка как в astra-engine/director/sounds.ts и music.ts.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MusicTrack } from "../protocol";
import { on } from "./features";
import { duration, ffmpeg, MEDIA_ROOT, NEWS_ROOT, run } from "./util";

const AUDIO = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;
const CACHE = path.join(NEWS_ROOT, ".cache");

/**
 * Громкость роли у Астры (голос около −19 LUFS). У нас голос −15,5, но звуки идут фоном под ним: владелец 28.10 —
 * «звуки sfx громкие очень, они должны быть тихими на фоне» — на 8 дБ тише прежнего (+4 → −4), затем «давай ещё
 * чуть-чуть на −5» (−4 → −9): всего на 13 дБ тише первых роликов.
 */
// glitch на 10,5 дБ тише прежнего (−29): его резкое «иии» на 6–11 кГц режет ухо (владелец 3.11: «убери звук „ии“ либо сделай
// его на 70% тише»)
const ROLE_LOUDNESS: Record<string, number> = { whoosh: -28, swipe: -28, pop: -28, notification: -26, impact: -25, glitch: -39.5, cash: -27 };
const MAX_SECONDS: Record<string, number> = { whoosh: 1.6, swipe: 1.2, pop: 1.2, notification: 1.8, impact: 1.8, glitch: 1.2, cash: 2.5 };
const VOICE_SHIFT = -9;
/**
 * Звук зелёной заставки — universfield-fast-swoosh-06 (владелец 29.10: «звук не подходит, используй этот
 * universfield-fast-swoosh-06-567195.mp3»; до того пробовали звук, вытащенный из роликов автора). Громкость — как у
 * заставки автора: на 7,7 дБ тише голоса (у нас голос — около −18 в пике momentary), без общего VOICE_SHIFT.
 */
const INTRO_LOUDNESS = -26;
/** Подготовленный звук зависит и от настроек выше: другая громкость — другой файл в кэше. */
const SFX_SETUP = JSON.stringify([ROLE_LOUDNESS, MAX_SECONDS, VOICE_SHIFT, INTRO_LOUDNESS]);
/**
 * Имя звука в монтаже → папка роли и файл; level — своя громкость вместо роли. intro — звук заставки первой секунды,
 * ownerIn и ownerOut — владелец поднимается снизу и уходит (владелец 29.10: «звук входа тоже нужен и выхода»).
 */
const SOUNDS: Record<string, { role: string; prefer?: RegExp; level?: number }> = {
  intro: { role: "swipe", prefer: /fast-swoosh-06/i, level: INTRO_LOUDNESS },
  ownerIn: { role: "whoosh", prefer: /motion-3/i },
  ownerOut: { role: "whoosh", prefer: /whoosh-end/i },
  whoosh: { role: "whoosh", prefer: /motion/i },
  swish: { role: "swipe", prefer: /swoosh/i },
  pop: { role: "pop" },
  ding: { role: "notification" },
  glitch: { role: "glitch" },
  boom: { role: "impact" },
  cash: { role: "cash", prefer: /kaching/i },
};

/**
 * Сколько разных файлов одной роли звучит в ролике: у звука без выбранного файла (prefer) — по очереди, а не всегда первый
 * файл папки (31.10, каталог видео-скиллов: «каждый поп звучит одинаково»). Звуки, выбранные владельцем, не меняются.
 */
const VARIANTS = 6;

const files = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => AUDIO.test(f)).sort() : []);
const hash = (file: string) => createHash("sha1").update(SFX_SETUP).update(fs.readFileSync(file)).digest("hex").slice(0, 12);

async function analysis(args: string[]) {
  return (await run("ffmpeg", ["-hide_banner", "-nostats", ...args])).stderr;
}
const peak = async (f: string) => Number((await analysis(["-i", f, "-af", "volumedetect", "-f", "null", "-"])).match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? 0);
const momentaryMax = async (f: string) => {
  const v = [...(await analysis(["-i", f, "-af", "apad=pad_dur=0.6,ebur128", "-f", "null", "-"])).matchAll(/M:\s*(-?[\d.]+)/g)].map((m) => Number(m[1])).filter((x) => x > -70);
  return v.length ? Math.max(...v) : -40;
};

/** Звук без тишины по краям, не длиннее роли, мягче наверху и на своей громкости за голосом. */
async function prepareSfx(source: string, role: string, target: string, own?: number) {
  // свои временные файлы у каждого задания: монтажи идут разом и готовят один и тот же звук в общем кэше (3.11: EPERM на
  // intro-….shape.wav, когда после смены громкостей кэш был пуст)
  const tmp = `${target}.${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const trimmed = `${tmp}.trim.wav`;
  const shaped = `${tmp}.shape.wav`;
  await ffmpeg(["-i", source, "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.01,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse", "-ar", "48000", "-ac", "2", trimmed]);
  const max = MAX_SECONDS[role] ?? 2;
  const length = await duration(trimmed);
  const fades = length > max ? `afade=t=out:st=${(max - 0.12).toFixed(3)}:d=0.12` : "anull";
  // звук со своей громкостью (заставка) — как есть, без смягчения верхов
  await ffmpeg(["-i", trimmed, "-t", String(Math.min(length, max)), "-af", own !== undefined ? fades : `${fades},highshelf=f=6500:g=-3`, shaped]);
  const level = own ?? (ROLE_LOUDNESS[role] ?? -28) + VOICE_SHIFT;
  const gain = Math.min(level - (await momentaryMax(shaped)), -6 - (await peak(shaped)));
  await ffmpeg(["-i", shaped, "-af", `volume=${gain.toFixed(2)}dB`, "-c:a", "pcm_s16le", `${tmp}.wav`]);
  fs.renameSync(`${tmp}.wav`, target);
  fs.rmSync(trimmed, { force: true });
  fs.rmSync(shaped, { force: true });
}

/** Все звуки монтажа в папку sfx задания (подготовленные копии кэшируются по содержимому исходника). */
/**
 * Звуки при каждом монтаже берутся заново из news/sounds: убрал владелец папку роли — этого звука нет ни в новых
 * роликах, ни в перемонтаже старых. Возвращает имена звуков, которые есть; варианты одного звука — pop, pop~1, pop~2…
 * (первым остаётся прежний первый файл папки, добавленные cc0-* — после своих).
 */
export async function prepareSounds(outDir: string): Promise<string[]> {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const ready: string[] = [];
  for (const [name, { role, prefer, level }] of Object.entries(SOUNDS)) {
    const dir = path.join(MEDIA_ROOT, "sounds", role);
    const list = files(dir);
    if (!list.length) continue;
    const picked = list.find((f) => prefer?.test(f));
    const own = [...list.filter((f) => !f.startsWith("cc0-")), ...list.filter((f) => f.startsWith("cc0-"))];
    const sources = picked ? [picked] : on("sfxVariety") ? own.slice(0, VARIANTS) : [own[0]];
    for (const [k, file] of sources.entries()) {
      const source = path.join(dir, file);
      // громкость роли — в имени: поменяли её, и звук готовится заново, а не берётся прежний из кэша
      const cached = path.join(CACHE, "sfx", `${name}-${hash(source)}-${level ?? ROLE_LOUDNESS[role] ?? -28}.wav`);
      if (!fs.existsSync(cached)) {
        fs.mkdirSync(path.dirname(cached), { recursive: true });
        await prepareSfx(source, role, cached, level);
      }
      const id = k ? `${name}~${k}` : name;
      fs.copyFileSync(cached, path.join(outDir, `${id}.wav`));
      ready.push(id);
    }
  }
  return ready;
}

/** Подпись подготовленного куска: меняется с содержимым файла и со способом подготовки (BED_VERSION). */
const BED_VERSION = "bed1";
const BED_SECONDS = 90;
const known = new Map<string, { stamp: string; sig: string; duration: number }>();

/**
 * Треки в news/music: имя файла без расширения — название; sig — чтобы сайт знал, какие куски у него есть. Файлы
 * читаются целиком только при изменении (размер и время): список уходит на сайт каждые 5 секунд.
 */
export async function listTracks(): Promise<MusicTrack[]> {
  const dir = path.join(MEDIA_ROOT, "music");
  const out: MusicTrack[] = [];
  for (const f of files(dir)) {
    const full = path.join(dir, f);
    const st = fs.statSync(full);
    const stamp = `${st.size}:${st.mtimeMs}`;
    let k = known.get(full);
    if (k?.stamp !== stamp) {
      const sig = createHash("sha1").update(BED_VERSION).update(fs.readFileSync(full)).digest("hex").slice(0, 16);
      k = { stamp, sig, duration: Math.round(await duration(full)) };
      known.set(full, k);
    }
    out.push({ file: f, title: f.replace(AUDIO, ""), duration: k.duration, sig: k.sig });
  }
  return out;
}

/**
 * Кусок трека для сайта: самая насыщенная часть на BED_SECONDS, громкость −14 LUFS (prepareMusic). Сайт кладёт его
 * под ролик без музыки сразу при выборе — и в плеере, и в склейке для публикации.
 */
export async function prepareBed(track: MusicTrack): Promise<string> {
  const target = path.join(CACHE, "beds", `${track.sig}.m4a`);
  if (!fs.existsSync(target)) {
    const tmp = `${target}.tmp.m4a`;
    await prepareMusic(track.file, BED_SECONDS, tmp);
    fs.renameSync(tmp, target);
  }
  return target;
}

/** Трек под ролик: с самой насыщенной части, на −14 LUFS, длиной с ролик (монтаж зацикливает, если короче). */
export async function prepareMusic(file: string, length: number, target: string) {
  const source = path.join(MEDIA_ROOT, "music", file);
  if (!fs.existsSync(source)) throw new Error(`Трека «${file}» нет в news/music`);
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-v", "info", "-i", source, "-vn", "-af", "aresample=16000,asetnsamples=n=16000,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"]);
  const levels = [...stderr.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (Number.isFinite(parseFloat(m[1])) ? parseFloat(m[1]) : -100));
  const win = 8;
  const avg = levels.map((_, i) => (i + win <= levels.length ? levels.slice(i, i + win).reduce((a, b) => a + b, 0) / win : -100));
  const best = Math.max(...avg);
  const first = Math.max(0, avg.findIndex((v) => v >= best - 2));
  const start = Math.max(0, Math.min(first - 1, levels.length - Math.min(length, levels.length)));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // только звук: в mp3 с сайтов бывает обложка-картинка, а в m4a её дорожке места нет
  await ffmpeg(["-ss", String(start), "-i", source, "-t", String(Math.ceil(length + 2)), "-map", "0:a:0", "-vn", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.6", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", target]);
}
