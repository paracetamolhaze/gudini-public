import { spawn } from "child_process";
import { MUSIC_VOLUME } from "./types";

/**
 * The published out.mp4 from the PC's render without music and the prepared piece of a track: the picture is copied
 * as is, the track goes under the sound looped at MUSIC_VOLUME, in over 0.33 s and out over the last 0.5 s, as the
 * montage engine laid it before. A minute of video takes a second or two, so a new track needs no new render.
 */
export async function mixTrack(base: string, track: string, duration: number, target: string): Promise<void> {
  const fadeOut = Math.max(0, duration - 0.5).toFixed(3);
  const music = `[1:a]volume=${MUSIC_VOLUME},afade=t=in:d=0.33,afade=t=out:st=${fadeOut}:d=0.5[m]`;
  const mix = "[0:a][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.93:level=disabled[a]";
  await ffmpeg(["-y", "-v", "error", "-i", base, "-stream_loop", "-1", "-i", track, "-filter_complex", `${music};${mix}`, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "mp4", target]);
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg не запустился: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg не склеил музыку (код ${code}): ${err.trim().slice(-400)}`));
    });
  });
}
