import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Word } from "../src/input";

type Recording = { duration: number; words: Word[]; recording: string };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const repairFile = (workDir: string) => path.join(workDir, "repair.json");
// Recomputing silence cuts can round an edge by a millisecond; this is well below one video frame.
const TIMING_TOLERANCE = 0.002;
const wordTimings = (words: Word[]) => words.map(w => [w.word, w.start, w.end] as const);
function sameWords(saved: unknown, words: Word[]): boolean {
  return Array.isArray(saved) && saved.length === words.length && saved.every((entry, i) =>
    Array.isArray(entry) && entry.length === 3 && entry[0] === words[i].word
    && typeof entry[1] === "number" && typeof entry[2] === "number"
    && Math.abs(entry[1] - words[i].start) <= TIMING_TOLERANCE
    && Math.abs(entry[2] - words[i].end) <= TIMING_TOLERANCE);
}

function recordingFingerprint(file: string): string {
  const fingerprint = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes: number;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) fingerprint.update(buffer.subarray(0, bytes));
    return fingerprint.digest("hex");
  } finally { fs.closeSync(fd); }
}

/** Explicitly staged repair, outside run/ because the normal retry clears that directory. */
export function stageRepair(workDir: string, source: Recording, code: string): void {
  const manifest = { version: 1, code, codeHash: hash(code), duration: source.duration, words: wordTimings(source.words), recordingFingerprint: recordingFingerprint(source.recording) };
  fs.mkdirSync(workDir, { recursive: true });
  const file = repairFile(workDir);
  fs.writeFileSync(file + ".part", JSON.stringify(manifest));
  fs.renameSync(file + ".part", file);
}

/** A saved montage is reusable only for the same recording and cleaned transcript. */
export function loadRepair(workDir: string, source: Recording): { code: string; token: string } | undefined {
  const file = repairFile(workDir);
  if (!fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, "utf8");
  let manifest: ReturnType<typeof JSON.parse>;
  try { manifest = JSON.parse(text); } catch { throw new Error("Астра: повреждён файл исправленного монтажа"); }
  if (manifest?.version !== 1 || typeof manifest.code !== "string" || !manifest.code.trim() || hash(manifest.code) !== manifest.codeHash) {
    throw new Error("Астра: повреждён файл исправленного монтажа");
  }
  if (!Number.isFinite(manifest.duration) || Math.abs(source.duration - manifest.duration) > TIMING_TOLERANCE
    || !sameWords(manifest.words, source.words) || recordingFingerprint(source.recording) !== manifest.recordingFingerprint) {
    throw new Error("Астра: запись или расшифровка изменилась; сохранённый исправленный монтаж к ней не подходит");
  }
  return { code: manifest.code, token: hash(text) };
}

/** Keep a repair after a failed run; remove it only after success, without consuming a newer repair. */
export function consumeRepair(workDir: string, token: string): void {
  const file = repairFile(workDir);
  if (fs.existsSync(file) && hash(fs.readFileSync(file, "utf8")) === token) fs.unlinkSync(file);
}
