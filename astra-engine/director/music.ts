// Music for one video: the tracks Astra names for it are found on YouTube, the first that downloads is cut
// from its fullest part and brought to one loudness. The owner chose YouTube over a licensed library.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type TrackWish = { query: string; why?: string };
type Found = { id: string; title: string; duration: number; views: number };

/**
 * The owner's track (2026-09-30: «всегда её»): every video plays it and Astra does not pick one.
 * ASTRA_MUSIC_TRACK=<YouTube id> sets another, ASTRA_MUSIC_TRACK=astra gives the choice back to Astra.
 */
export function ownerTrack(): { id: string; title: string } | null {
  const env = process.env.ASTRA_MUSIC_TRACK?.trim();
  if (env === "astra") return null;
  if (env) return { id: env, title: env };
  return { id: "wL8DVHuWI7Y", title: "VØJ, Narvent - Memory Reboot" };
}

/** Search results for a query that are songs, not hour-long mixes: most watched first. */
async function search(query: string): Promise<Found[]> {
  const { stdout } = await run("yt-dlp", ["--flat-playlist", "--no-warnings", "--print", "%(id)s\t%(duration)s\t%(view_count)s\t%(title)s", `ytsearch6:${query}`],
    { timeout: 60_000, maxBuffer: 4 << 20 });
  return stdout.split(/\r?\n/).map(line => line.split("\t")).filter(parts => parts.length >= 4)
    .map(([id, duration, views, ...title]) => ({ id, duration: Number(duration), views: Number(views) || 0, title: title.join(" ") }))
    .filter(f => f.id && f.duration >= 60 && f.duration <= 480 && !/\b(1 ?hour|hours|mix|compilation|playlist)\b/i.test(f.title))
    .sort((a, b) => b.views - a.views);
}

/** Loudness of every second of a file, in dB. */
async function secondLevels(file: string): Promise<number[]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-v", "info", "-i", file, "-vn", "-af",
    "aresample=16000,asetnsamples=n=16000,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level",
    "-f", "null", "-"], { maxBuffer: 16 << 20 });
  return [...stderr.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map(m => (Number.isFinite(parseFloat(m[1])) ? parseFloat(m[1]) : -100));
}

/** Where the track is in full: the first stretch of eight seconds almost as loud as its loudest one. */
function fullestStart(levels: number[], length: number): number {
  const win = 8;
  if (levels.length <= win) return 0;
  const avg = levels.map((_, i) => (i + win <= levels.length ? levels.slice(i, i + win).reduce((a, b) => a + b, 0) / win : -100));
  const best = Math.max(...avg);
  const first = avg.findIndex(v => v >= best - 2);
  // Start a little before the beat comes in; a video longer than what is left loops the track (the kit loops music).
  return Math.max(0, Math.min(first - 1, levels.length - Math.min(length, levels.length)));
}

/**
 * The first of Astra's wishes that YouTube has: downloaded, cut from its fullest part to the video's length
 * and normalized to -14 LUFS (the kit lays it under the voice and lowers it while the author speaks).
 */
/** The tracks of recent videos, newest last. */
export function recentTracks(historyFile: string | undefined): { id: string; title: string }[] {
  if (!historyFile) return [];
  try { return (JSON.parse(fs.readFileSync(historyFile, "utf8")) as { id: string; title: string }[]).slice(-12); } catch { return []; }
}

export async function prepareMusic(opts: {
  wishes: TrackWish[]; duration: number; publicDir: string; subdir: string; log: (line: string) => void; historyFile?: string;
  /** A track chosen in advance: taken as is, even if recent videos played it. */
  pinned?: { id: string; title: string };
}): Promise<{ file: string; title: string } | null> {
  const dir = path.join(opts.publicDir, opts.subdir);
  fs.mkdirSync(dir, { recursive: true });
  const used = new Set(recentTracks(opts.historyFile).map(t => t.id));
  const candidates: { wish: TrackWish; lookUp: () => Promise<Found[]> }[] = opts.pinned
    ? [{ wish: { query: opts.pinned.title, why: "трек владельца" }, lookUp: async () => [{ ...opts.pinned!, duration: 0, views: 0 }] }]
    : opts.wishes.slice(0, 4).map(wish => ({ wish, lookUp: async () => (await search(wish.query)).filter(f => !used.has(f.id)) }));
  for (const { wish, lookUp } of candidates) {
    let found: Found[] = [];
    try { found = await lookUp(); } catch (error) { opts.log(`Музыка: поиск «${wish.query}» не удался: ${String((error as Error).message).slice(0, 120)}`); }
    for (const track of found.slice(0, 2)) {
      const source = path.join(dir, `music-src-${track.id}`);
      try {
        await run("yt-dlp", ["-f", "bestaudio", "-x", "--audio-format", "m4a", "--no-playlist", "--no-warnings", "--max-filesize", "40M",
          "-o", `${source}.%(ext)s`, `https://www.youtube.com/watch?v=${track.id}`], { timeout: 180_000, maxBuffer: 16 << 20 });
        if (!fs.existsSync(`${source}.m4a`)) continue;
        const start = fullestStart(await secondLevels(`${source}.m4a`), opts.duration);
        const file = path.join(dir, `music-${track.id}.m4a`);
        await run("ffmpeg", ["-v", "error", "-y", "-ss", String(start), "-i", `${source}.m4a`, "-t", String(Math.ceil(opts.duration + 2)),
          "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.6", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", file], { timeout: 120_000 });
        opts.log(`Музыка: «${track.title}» (${Math.round(track.views / 1000)} тыс. просмотров), с ${start} с — ${wish.why ?? wish.query}`);
        if (opts.historyFile) {
          try {
            fs.mkdirSync(path.dirname(opts.historyFile), { recursive: true });
            fs.writeFileSync(opts.historyFile, JSON.stringify([...recentTracks(opts.historyFile), { id: track.id, title: track.title, at: new Date().toISOString() }].slice(-30), null, 2));
          } catch { /* the next video may repeat the track */ }
        }
        return { file: path.relative(opts.publicDir, file).split(path.sep).join("/"), title: track.title };
      } catch (error) {
        opts.log(`Музыка: «${track.title}» не скачалась: ${String((error as Error).message).slice(0, 120)}`);
      } finally {
        fs.rmSync(`${source}.m4a`, { force: true });
      }
    }
  }
  return null;
}
