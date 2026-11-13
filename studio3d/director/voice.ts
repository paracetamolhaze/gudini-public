import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Script3D } from "./api";
import type { CastFile } from "./cast";
import { deliverTake, type Turn } from "./delivery";
import { voiceDialogue } from "./elevenlabs";
import { hasWords, voiceByLines, voiceLineClips, type LineClipFile } from "./lineVoice";
import { voicedLines, type Alignment, type VoiceSegment, type VoicedLine } from "./mouth";
import type { Recording } from "./recorded";
import { alignLinesToAudio, envelope } from "./timing";

const run = promisify(execFile);

/** file is what the video plays (the take with the cast's delivery); take is ElevenLabs' track as it came. */
export type Voiced = { file: string; take: string; lines: VoicedLine[]; duration: number; characters: number };
type Raw = { alignment: Alignment; segments: VoiceSegment[]; characters: number };

/** Who speaks when, straight from the take's voice segments (the exact bounds ElevenLabs mixed the voices at). */
const turnsOf = (raw: Raw, script: Script3D): Turn[] =>
  raw.segments.map((s) => ({ who: script.lines[s.dialogue_input_index]?.who ?? "me", start: s.start_time_seconds, end: s.end_time_seconds }));

/** Takes cached before the raw timings were kept have only their lines: a turn reaches halfway to the neighbours. */
const turnsOfLines = (lines: VoicedLine[], total: number): Turn[] => {
  const sorted = [...lines].sort((a, b) => a.start - b.start);
  return sorted.map((l, i) => ({ who: l.who, start: i ? (sorted[i - 1].end + l.start) / 2 : 0, end: i < sorted.length - 1 ? (l.end + sorted[i + 1].start) / 2 : total }));
};

export const mediaDuration = async (file: string) => {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(stdout.trim());
};

/** Lines of the script from the raw take: one input may come back as several segments, they are joined per line. */
const linesOf = (raw: Raw, script: Script3D): VoicedLine[] => {
  const byLine = new Map<number, VoiceSegment>();
  for (const seg of raw.segments) {
    const prev = byLine.get(seg.dialogue_input_index);
    byLine.set(
      seg.dialogue_input_index,
      prev
        ? {
            ...prev,
            start_time_seconds: Math.min(prev.start_time_seconds, seg.start_time_seconds),
            end_time_seconds: Math.max(prev.end_time_seconds, seg.end_time_seconds),
            character_start_index: Math.min(prev.character_start_index, seg.character_start_index),
            character_end_index: Math.max(prev.character_end_index, seg.character_end_index),
          }
        : seg,
    );
  }
  const segments = [...byLine.values()].sort((a, b) => a.start_time_seconds - b.start_time_seconds);
  // the script index goes along with every line: the dubbing page and the dub job find a line by it
  return voicedLines(raw.alignment, segments, (s) => script.lines[s.dialogue_input_index]?.who ?? "me")
    .map((l, k) => ({ ...l, index: segments[k].dialogue_input_index }))
    .filter((l) => l.words.length);
};

const lineByLine = (cast: CastFile) => Object.values(cast).some((m) => m.tts);
/** Lines with words to say: a line of tags only ([laughs], [pause]) has no words for lips and subtitles. */
const spokenLines = (script: Script3D) => script.lines.filter((l) => hasWords(l.text)).length;

/** Where the per-line takes live inside a project's work folder: the "voice" job and the montage share them. */
const voiceDir = (workDir: string) => path.join(workDir, "voice");

/**
 * The script's lines synthesized one by one for the owner's recording page ("voice" job), into the same cache the
 * montage reads, so the montage after it pays nothing. Only line-by-line voicing has lines of their own.
 */
export async function voiceClips(script: Script3D, cast: CastFile, workDir: string, signal?: AbortSignal, log?: (m: string) => void, onLine?: (done: number, total: number) => void): Promise<LineClipFile[]> {
  if (!lineByLine(cast)) throw new Error('Отдельные реплики есть только у построчной озвучки: задайте героям "tts" в cast.json');
  return voiceLineClips(script, cast, voiceDir(workDir), signal, log, onLine);
}

/**
 * The dialogue voiced in one take. The same lines with the same voices are never paid for twice: the take and
 * ElevenLabs' raw timings stay in the project's folder under a hash of everything that shapes the sound, and the
 * lines are derived again on every run — then moved onto the speech actually heard in the track.
 * `recordings` are the owner's own takes of his lines; they replace his synthesized lines (line-by-line voicing only).
 */
export async function voiceScript(script: Script3D, cast: CastFile, workDir: string, signal?: AbortSignal, log?: (m: string) => void, recordings: Recording[] = []): Promise<Voiced> {
  // the cast's delivery goes onto the finished take; a dialogue take's lines are then moved onto the speech heard
  const finish = async (take: string, lines: VoicedLine[], turns: Turn[], characters: number, onSound: boolean): Promise<Voiced> => {
    if (lines.length !== spokenLines(script)) log?.(`Голос вернул ${lines.length} реплик со словами из ${spokenLines(script)}`);
    const delivered = await deliverTake(take, turns, cast, signal, log);
    const timed = onSound ? alignLinesToAudio(lines, await envelope(delivered)) : lines;
    const duration = await mediaDuration(delivered);
    log?.(`Озвучка: ${duration.toFixed(1)} с${onSound ? ", реплики выровнены по звуку" : ""}`);
    return { file: delivered, take, lines: timed, duration, characters };
  };

  // each voice with its own model and pace (cast.json "tts"): voiced line by line and joined. A single line's
  // letter timings match its audio within a tenth of a second, so they are kept: moving them onto the loudness
  // envelope would hand a performed [laughs] or [gasps] to the line before it
  if (lineByLine(cast)) {
    const take = await voiceByLines(script, cast, voiceDir(workDir), signal, log, recordings);
    const lines = linesOf(take.raw, script);
    if (lines.length < Math.min(2, spokenLines(script))) throw new Error("ElevenLabs вернул пустую озвучку");
    return finish(take.file, lines, turnsOf(take.raw, script), take.raw.characters, false);
  }

  // one dialogue take has no place to put a recorded line into
  if (recordings.length) throw new Error('Свой голос работает только с построчной озвучкой: задайте героям "tts" в cast.json');
  const model = process.env.STUDIO3D_VOICE_MODEL || "eleven_v3";
  const inputs = script.lines.map((l) => {
    const member = cast[l.who];
    if (!member) throw new Error(`В сценарии неизвестный персонаж ${l.who}`);
    // one delivery for the whole cast (cast.json "style", e.g. [softly]); a line's own tag still leads where it has one
    const style = member.style?.trim();
    return { text: style && !l.text.trimStart().startsWith("[") ? `${style} ${l.text}` : l.text, voice_id: member.voice };
  });
  const key = crypto.createHash("sha1").update(JSON.stringify({ inputs, model })).digest("hex").slice(0, 16);
  const dir = path.join(workDir, "voice");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${key}.mp3`);
  const rawFile = path.join(dir, `${key}.raw.json`);
  const metaFile = path.join(dir, `${key}.json`);

  let lines: VoicedLine[];
  let turns: Turn[];
  let characters = 0;
  if (fs.existsSync(file) && fs.existsSync(rawFile)) {
    log?.("Озвучка этого сценария уже есть — беру её");
    const raw = JSON.parse(fs.readFileSync(rawFile, "utf8")) as Raw;
    lines = linesOf(raw, script);
    turns = turnsOf(raw, script);
    characters = raw.characters;
  } else if (fs.existsSync(file) && fs.existsSync(metaFile)) {
    // takes cached before the raw timings were kept
    log?.("Озвучка этого сценария уже есть — беру её");
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as { lines: VoicedLine[]; characters: number };
    lines = meta.lines;
    turns = turnsOfLines(lines, await mediaDuration(file));
    characters = meta.characters;
  } else {
    const res = await voiceDialogue(inputs, signal);
    const raw: Raw = { alignment: res.alignment, segments: res.segments, characters: res.characters };
    lines = linesOf(raw, script);
    if (lines.length < Math.min(2, spokenLines(script))) throw new Error("ElevenLabs вернул пустую озвучку");
    fs.writeFileSync(file, res.audio);
    fs.writeFileSync(rawFile, JSON.stringify(raw));
    turns = turnsOf(raw, script);
    characters = res.characters;
    log?.(`Озвучка: ${res.characters} знаков ElevenLabs`);
  }
  return finish(file, lines, turns, characters, true);
}
