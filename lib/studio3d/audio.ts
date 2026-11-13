import { spawn } from "child_process";
import fs from "fs";
import { ffmpegBin, ffprobeBin } from "../ffmpeg";

/**
 * Audio helpers of the «3Д» self-dub: what the browser recorded, turned into the FLAC the montage uses.
 * ffmpeg and ffprobe are in the site image (and on the owner's PC).
 */

export type AudioKind = "webm" | "ogg" | "mp4" | "wav" | "mp3";

/** By magic bytes, not by Content-Type: browsers label the same recording differently. */
export function sniffAudio(buf: Buffer): AudioKind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "webm";
  if (buf.toString("latin1", 0, 4) === "OggS") return "ogg";
  if (buf.toString("latin1", 4, 8) === "ftyp") return "mp4";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WAVE") return "wav";
  if (buf.toString("latin1", 0, 3) === "ID3") return "mp3";
  // a bare MPEG audio frame: sync bits, a real version and layer (ADTS AAC has layer 0 and is not mp3)
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && ((buf[1] >> 3) & 3) !== 1 && ((buf[1] >> 1) & 3) !== 0) return "mp3";
  return null;
}

/** A tool that ran and failed on the input (as opposed to a missing ffmpeg, which stays a server error). */
export class AudioToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioToolError";
  }
}

function run(bin: string, args: string[], timeoutMs = 60_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new AudioToolError(`${bin}: не уложился в ${Math.round(timeoutMs / 1000)} с`));
    }, timeoutMs);
    proc.stdout.on("data", (d) => (stdout += d));
    // stderr of a long decode can be big: only its tail matters for errors and volumedetect
    proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-20_000)));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new AudioToolError(stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400) || `${bin}: код ${code}`));
    });
  });
}

export type AudioProbe = { duration: number; peakDb: number };

/** The loudest sample from volumedetect's log, in dBFS; -Infinity for digital silence, NaN when absent. */
function parsePeak(stderr: string): number {
  const m = stderr.match(/max_volume:\s*(-?inf|-?[\d.]+)\s*dB/);
  return !m ? NaN : m[1].endsWith("inf") ? -Infinity : parseFloat(m[1]);
}

/** Exact duration from the STREAMINFO block (total samples / rate); null when ffmpeg could not fill it in. */
async function flacDuration(file: string): Promise<number | null> {
  const fh = await fs.promises.open(file, "r");
  try {
    const b = Buffer.alloc(26);
    const { bytesRead } = await fh.read(b, 0, 26, 0);
    if (bytesRead < 26 || b.toString("latin1", 0, 4) !== "fLaC" || (b[4] & 0x7f) !== 0) return null;
    const rate = (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
    const samples = (b[21] & 0x0f) * 2 ** 32 + b.readUInt32BE(22);
    return rate > 0 && samples > 0 ? samples / rate : null;
  } finally {
    await fh.close();
  }
}

/**
 * Mono 48 kHz 16-bit FLAC: lossless for the montage and small to keep. The peak is measured in the
 * same pass and the duration read from the FLAC header, so a take costs one ffmpeg run. Anything past
 * maxSeconds is not decoded at all: a too long upload costs little before it is refused.
 */
export async function toFlac(input: string, output: string, maxSeconds = 61): Promise<AudioProbe> {
  const { stderr } = await run(ffmpegBin(), [
    "-hide_banner", "-nostdin", "-nostats", "-y",
    "-i", input,
    "-t", String(maxSeconds),
    "-vn", "-af", "volumedetect", "-ac", "1", "-ar", "48000", "-sample_fmt", "s16", "-c:a", "flac",
    "-f", "flac", output,
  ]);
  const duration = await flacDuration(output);
  const peakDb = parsePeak(stderr);
  if (duration !== null && !Number.isNaN(peakDb)) return { duration, peakDb };
  return probe(output);
}

/** Duration from the container and the loudest sample in dBFS, for any audio file. */
export async function probe(file: string): Promise<AudioProbe> {
  const [info, vol] = await Promise.all([
    run(ffprobeBin(), ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]),
    run(ffmpegBin(), ["-hide_banner", "-nostdin", "-nostats", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"]),
  ]);
  const duration = parseFloat(info.stdout.trim());
  return { duration: Number.isFinite(duration) ? duration : 0, peakDb: parsePeak(vol.stderr) };
}
