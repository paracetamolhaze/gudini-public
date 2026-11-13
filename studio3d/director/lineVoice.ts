import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Script3D } from "./api";
import type { CastFile } from "./cast";
import { performsTags, speakLine, speechToSpeech, type LineResult, type LineSettings } from "./elevenlabs";
import type { Alignment, VoiceSegment } from "./mouth";
import { decodeMono, prepareRecording, RATE, SilentTakeError, type PreparedRecording, type Recording } from "./recorded";

const run = promisify(execFile);
/** Silence between two lines; a line the writer marked with [pause] waits longer. */
const GAP = 0.25;
const PAUSE = 0.7;
const TAIL = 0.3;
/** Bump when the way lines are joined changes, so old joined takes are not reused. */
const VERSION = 1;
/** A recorded take is brought to its voice's loudness by at most this many dB: beyond it the take is mostly noise. */
const MAX_TAKE_GAIN = 30;
/** The loudness meter gates 0.4 s blocks: a shorter sound reads -70 LUFS, so a short reply is measured repeated to this length. */
const MIN_MEASURED = 1.2;

export type LineTake = { file: string; raw: { alignment: Alignment; segments: VoiceSegment[]; characters: number }; paid: number };
/** One synthesized line as ElevenLabs returned it (the per-line cache file), for the owner's recording page. */
export type LineClipFile = { index: number; who: string; file: string; duration: number };

/** v3 audio tags ([excited], [pause]…) mean nothing to the line models: they would be read out loud. */
export const spokenText = (text: string) => text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
/**
 * A line has words when letters or digits are left once its [..] tags are gone. Only such a line must have a voice
 * clip and, in the owner's voice, a take; a line of tags only ([laughs], [pause]) may have neither. The site and the
 * runner use this same rule.
 */
export const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text.replace(/\[[^\]]*\]/g, " "));
/** What a voice is asked to say: eleven_v3 plays the emotion tags; a pause is the silence before the line either way. */
const requestText = (text: string, model: string) =>
  performsTags(model) ? text.replace(/\[(long )?pause\]/gi, " ").replace(/\s+/g, " ").trim() : spokenText(text);
const pauseBefore = (text: string) => (/\[(long )?pause\]/i.test(text) ? PAUSE : 0);

const hash = (v: unknown, n = 16) => crypto.createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, n);

const withTemp = async <T>(samples: Float32Array, use: (file: string) => Promise<T>): Promise<T> => {
  const file = path.join(os.tmpdir(), `studio3d-${process.pid}-${crypto.randomUUID()}.f32`);
  fs.writeFileSync(file, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  try {
    return await use(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
};

/** Integrated loudness (EBU R128) of a voice's lines played one after another. */
const loudnessOf = (samples: Float32Array) =>
  withTemp(samples, async (file) => {
    // framelog=verbose keeps the per-frame lines below the default log level; "quiet" is unknown to ffmpeg 5.1 in the image
    const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", file, "-af", "ebur128=framelog=verbose", "-f", "null", "-"], { maxBuffer: 1 << 26 });
    const all = [...stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
    return all.length ? Number(all[all.length - 1][1]) : NaN;
  });

/**
 * Loudness of the words of a recorded take, without the air around them. A reply shorter than the meter's block is
 * repeated until it is long enough: a sound played over and over has its own loudness, and a «Да.» is levelled
 * like the owner's long lines instead of being left at the mic's level.
 */
const speechLoudness = (audio: Float32Array, speech: [number, number]) =>
  wordsLoudness(audio.subarray(Math.max(0, Math.floor(speech[0] * RATE)), Math.min(audio.length, Math.ceil(speech[1] * RATE))));

/** Loudness of speech without its air; a sound shorter than the meter's block is measured repeated (see above). */
export const wordsLoudness = (words: Float32Array) => {
  if (!words.length) return Promise.resolve(NaN);
  const need = Math.round(MIN_MEASURED * RATE);
  if (words.length >= need) return loudnessOf(words);
  const looped = new Float32Array(Math.ceil(need / words.length) * words.length);
  for (let at = 0; at < looped.length; at += words.length) looped.set(words, at);
  return loudnessOf(looped);
};

/** Mono 44.1 kHz samples to an mp3 at 192k, renamed into place when whole. */
export const encode = (samples: Float32Array, out: string) =>
  withTemp(samples, async (file) => {
    const tmp = `${out}.part.mp3`;
    await run("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", file, "-c:a", "libmp3lame", "-b:a", "192k", tmp]);
    fs.renameSync(tmp, out);
  });

type LineJob = { i: number; who: string; voice: string; text: string; settings: LineSettings; context: { previous?: string; next?: string }; file: string; meta: string };

/**
 * What each line is asked of its voice, and the cache files named after exactly that. The line models hear their
 * neighbours as context, so editing a line also re-voices the lines next to it in those voices. The context is the
 * script's words, so a line recorded by the owner changes nothing for Claude's lines around it.
 */
const lineJobs = (script: Script3D, cast: CastFile, linesDir: string): LineJob[] => {
  const spoken = script.lines.map((l) => spokenText(l.text));
  return script.lines.map((l, i) => {
    const member = cast[l.who];
    if (!member?.tts) throw new Error(`У персонажа ${l.who} нет настроек построчной озвучки (cast.json "tts")`);
    const { loudness: _loudness, ...settings } = member.tts;
    // a line that is only a tag ([laughs]) is still played by a voice that performs tags
    const text = requestText(l.text, settings.model);
    const context = performsTags(settings.model) ? {} : { previous: spoken[i - 1] || undefined, next: spoken[i + 1] || undefined };
    const key = hash({ text, voice: member.voice, settings, context });
    return { i, who: l.who, voice: member.voice, text, settings: settings as LineSettings, context, file: path.join(linesDir, `${key}.mp3`), meta: path.join(linesDir, `${key}.json`) };
  });
};

const cached = (j: LineJob) => fs.existsSync(j.file) && fs.existsSync(j.meta);

/**
 * The owner's voice of «Новости»: the read line sped up by tempo (rubberband keeps pitch and formants) and spoken
 * again by speech-to-speech in the same voice. Speech-to-speech keeps the timing, so the letters move by tempo alone;
 * the montage still fits the lines to the sound envelope afterwards (timing.ts).
 */
async function revoice(read: LineResult, voice: string, s: LineSettings, signal?: AbortSignal): Promise<LineResult> {
  const tempo = s.tempo ?? 1;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio3d-revoice-"));
  try {
    const source = path.join(dir, "read.mp3");
    const fast = path.join(dir, "fast.wav");
    fs.writeFileSync(source, read.audio);
    await run("ffmpeg", ["-v", "error", "-y", "-i", source, "-af", `rubberband=tempo=${tempo}:pitchq=quality:formant=preserved`, "-ar", String(RATE), fast], { signal });
    let audio: Buffer;
    if (s.sts) audio = await speechToSpeech(fs.readFileSync(fast), voice, s.sts, signal);
    else {
      const out = path.join(dir, "fast.mp3");
      await run("ffmpeg", ["-v", "error", "-y", "-i", fast, "-c:a", "libmp3lame", "-b:a", "192k", out], { signal });
      audio = fs.readFileSync(out);
    }
    const a = read.alignment;
    const alignment: Alignment = {
      characters: a.characters,
      character_start_times_seconds: a.character_start_times_seconds.map((t) => t / tempo),
      character_end_times_seconds: a.character_end_times_seconds.map((t) => t / tempo),
    };
    return { audio, alignment, characters: read.characters };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The lines not in the cache yet, two requests at a time: the plan's concurrency limit, and a failure stops the rest early. */
async function synthesize(jobs: LineJob[], signal?: AbortSignal, log?: (m: string) => void, onLine?: (done: number, total: number) => void): Promise<number> {
  let paid = 0;
  const wanted = jobs.filter((j) => j.text);
  const missing = wanted.filter((j) => !cached(j));
  let done = wanted.length - missing.length;
  onLine?.(done, wanted.length);
  for (let k = 0; k < missing.length; k += 2) {
    signal?.throwIfAborted();
    await Promise.all(
      missing.slice(k, k + 2).map(async (j) => {
        const spoken = await speakLine(j.text, j.voice, j.settings, j.context, signal);
        const res = j.settings.tempo || j.settings.sts ? await revoice(spoken, j.voice, j.settings, signal) : spoken;
        // the audio first and the timings last, each renamed into place: timings on disk mean a whole line
        fs.writeFileSync(`${j.file}.part`, res.audio);
        fs.renameSync(`${j.file}.part`, j.file);
        fs.writeFileSync(`${j.meta}.part`, JSON.stringify({ alignment: res.alignment, characters: res.characters }));
        fs.renameSync(`${j.meta}.part`, j.meta);
        paid += res.characters;
        onLine?.(++done, wanted.length);
      }),
    );
  }
  if (missing.length) log?.(`Озвучка: ${missing.length} реплик заново, ${paid} знаков ElevenLabs`);
  return paid;
}

/**
 * Every line synthesized exactly as the montage would voice it, into the same cache: the owner hears Claude's
 * line before recording his answer and his own synthesized line to compare, and a montage after it pays nothing.
 */
export async function voiceLineClips(script: Script3D, cast: CastFile, dir: string, signal?: AbortSignal, log?: (m: string) => void, onLine?: (done: number, total: number) => void): Promise<LineClipFile[]> {
  const linesDir = path.join(dir, "lines");
  fs.mkdirSync(linesDir, { recursive: true });
  const jobs = lineJobs(script, cast, linesDir);
  await synthesize(jobs, signal, log, onLine);
  const voiced = jobs.filter((j) => j.text);
  return Promise.all(voiced.map(async (j) => ({ index: j.i, who: j.who, file: j.file, duration: (await decodeMono(j.file, signal)).length / RATE })));
}

/**
 * The dialogue voiced line by line, each cast member with its own model, pace and loudness (cast.json "tts"),
 * then joined into one track with short pauses. The result has the same shape as a Text-to-Dialogue take —
 * letter timings and who-speaks-when — so lips and subtitles work on it unchanged.
 * Every line is cached on its own. A line with a recording (`recordings`, by script index) is played from the
 * owner's take instead of being synthesized, brought to his voice's loudness on its own first (takes are recorded
 * at different mic levels, synthesized lines are not) and then levelled together with the rest of his voice.
 */
export async function voiceByLines(script: Script3D, cast: CastFile, dir: string, signal?: AbortSignal, log?: (m: string) => void, recordings: Recording[] = []): Promise<LineTake> {
  const linesDir = path.join(dir, "lines");
  fs.mkdirSync(linesDir, { recursive: true });
  const jobs = lineJobs(script, cast, linesDir);

  // the recordings first: an empty take stops the run before anything is paid for
  const recorded = new Map<number, PreparedRecording>();
  for (const rec of recordings) {
    if (!jobs[rec.index]) throw new Error(`Запись для реплики ${rec.index + 1}, а в сценарии их ${jobs.length}`);
    signal?.throwIfAborted();
    const text = script.lines[rec.index].text;
    try {
      recorded.set(rec.index, await prepareRecording(rec, spokenText(text), path.join(dir, "recorded"), signal, log));
    } catch (error) {
      // a line of tags only ([pause], [laughs]) needs no take: a silent one leaves the line as if it had none
      if (!(error instanceof SilentTakeError) || hasWords(text)) throw error;
      log?.(`Запись реплики ${rec.index + 1} без звука, а слов в реплике нет — играю её без записи`);
    }
  }
  if (recorded.size) {
    const even = [...recorded.values()].filter((r) => r.source === "even").length;
    log?.(`Свой голос: записей ${recorded.size}${even ? `, без точных таймингов ${even}` : ""}`);
  }

  const paid = await synthesize(jobs.filter((j) => !recorded.has(j.i)), signal, log);

  const clips = await Promise.all(
    jobs.map(async (j) => {
      const own = recorded.get(j.i);
      if (own) return { audio: await decodeMono(own.file, signal), alignment: own.alignment, characters: 0 };
      return j.text ? { audio: await decodeMono(j.file, signal), ...(JSON.parse(fs.readFileSync(j.meta, "utf8")) as { alignment: Alignment; characters: number }) } : null;
    }),
  );

  // a take recorded closer to the mic or with another gain must not stand out: each one to the voice's target first
  const takeGains: [number, number][] = [];
  for (const [i, own] of recorded) {
    const target = cast[jobs[i].who]?.tts?.loudness;
    const clip = clips[i];
    if (target === undefined || !clip) continue;
    const measured = await speechLoudness(clip.audio, own.speech);
    if (!Number.isFinite(measured) || measured <= -69) {
      log?.(`Запись реплики ${i + 1} (${path.basename(own.file)}) слишком тихая, чтобы её измерить: громкость оставлена как записана`);
      continue;
    }
    const db = Math.max(-MAX_TAKE_GAIN, Math.min(MAX_TAKE_GAIN, target - measured));
    const k = 10 ** (db / 20);
    for (let n = 0; n < clip.audio.length; n++) clip.audio[n] *= k;
    takeGains.push([i, Math.round(db * 10) / 10]);
    if (Math.abs(db) >= MAX_TAKE_GAIN) log?.(`Запись реплики ${i + 1} (${path.basename(own.file)}) слишком ${db > 0 ? "тихая" : "громкая"}: громкость поправлена на ${db} дБ, не до конца`);
  }

  // each voice at its own loudness, measured over all its lines so short replies are not pushed up on their own
  const gains = new Map<string, number>();
  for (const who of new Set(jobs.map((j) => j.who))) {
    const target = cast[who]?.tts?.loudness;
    if (target === undefined) continue;
    const own = jobs.filter((j) => j.who === who && clips[j.i]).map((j) => clips[j.i]!.audio);
    const joined = new Float32Array(own.reduce((s, a) => s + a.length, 0));
    own.reduce((at, a) => (joined.set(a, at), at + a.length), 0);
    const measured = await loudnessOf(joined);
    if (Number.isFinite(measured)) gains.set(who, target - measured);
  }

  const alignment: Alignment = { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] };
  const segments: VoiceSegment[] = [];
  const pieces: { at: number; audio: Float32Array; gain: number }[] = [];
  let t = 0;
  let characters = 0;
  // a line with nothing to say (only [pause]) hands its silence on to the next voiced line
  let waiting = 0;
  for (const j of jobs) {
    waiting += pauseBefore(script.lines[j.i].text);
    const clip = clips[j.i];
    if (!clip) continue;
    if (segments.length) t += GAP;
    t += waiting;
    waiting = 0;
    const start = t;
    const duration = clip.audio.length / RATE;
    const from = alignment.characters.length;
    clip.alignment.characters.forEach((ch, n) => {
      alignment.characters.push(ch);
      alignment.character_start_times_seconds.push(start + clip.alignment.character_start_times_seconds[n]);
      alignment.character_end_times_seconds.push(start + clip.alignment.character_end_times_seconds[n]);
    });
    segments.push({ voice_id: j.voice, start_time_seconds: start, end_time_seconds: start + duration, character_start_index: from, character_end_index: alignment.characters.length, dialogue_input_index: j.i });
    pieces.push({ at: Math.round(start * RATE), audio: clip.audio, gain: 10 ** ((gains.get(j.who) ?? 0) / 20) });
    characters += clip.characters;
    t = start + duration;
  }
  if (!segments.length) throw new Error("ElevenLabs вернул пустую озвучку");
  const raw = { alignment, segments, characters };
  // the joined track is named after exactly what is in it: every line's place, its letters and the voices' gains;
  // a recorded line is named by its take's prepared file, so a re-recorded line makes a new track
  const sources = jobs.map((j) => (recorded.has(j.i) ? `rec:${path.basename(recorded.get(j.i)!.file)}` : path.basename(j.file)));
  const key = hash({ VERSION, TAIL, lines: sources, segments, gains: [...gains].map(([w, g]) => [w, Math.round(g * 10) / 10]), ...(takeGains.length ? { takeGains } : {}) });
  const file = path.join(dir, `${key}.mp3`);
  const rawFile = path.join(dir, `${key}.raw.json`);

  if (!fs.existsSync(file) || !fs.existsSync(rawFile)) {
    const track = new Float32Array(Math.round((t + TAIL) * RATE));
    for (const p of pieces) for (let n = 0; n < p.audio.length; n++) track[p.at + n] += p.audio[n] * p.gain;
    // a voice pushed up may peak over full scale: one static trim for the whole track keeps the balance
    let peak = 0;
    for (const v of track) peak = Math.max(peak, Math.abs(v));
    if (peak > 0.97) for (let n = 0; n < track.length; n++) track[n] *= 0.97 / peak;
    await encode(track, file);
    fs.writeFileSync(rawFile, JSON.stringify(raw));
  }
  return { file, raw, paid };
}
