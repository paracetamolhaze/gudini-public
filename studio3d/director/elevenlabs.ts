import fs from "node:fs";
import path from "node:path";
import type { Alignment, VoiceSegment } from "./mouth";

/** The key from the environment, or from the repo .env when run on the owner's PC. */
export const elevenKey = () => {
  const fromEnv = process.env.ELEVENLABS_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  for (const dir of [process.cwd(), path.resolve(import.meta.dirname, "../.."), "C:/Users/user/Desktop/gudini"]) {
    const file = path.join(dir, ".env");
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, "utf8").match(/^ELEVENLABS_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("Нет ключа ElevenLabs (ELEVENLABS_API_KEY)");
};

export type DialogueInput = { text: string; voice_id: string };
export type DialogueResult = { audio: Buffer; alignment: Alignment; segments: VoiceSegment[]; characters: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One mixed dialogue track with who-speaks-when and letter timings (Text to Dialogue, eleven_v3).
 * The model performs audio tags like [sighs]; they come back in the alignment and are dropped later.
 */
export const voiceDialogue = async (inputs: DialogueInput[], signal?: AbortSignal, seed?: number): Promise<DialogueResult> => {
  const key = elevenKey();
  const model = process.env.STUDIO3D_VOICE_MODEL || "eleven_v3";
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.elevenlabs.io/v1/text-to-dialogue/with-timestamps?output_format=mp3_44100_128", {
      method: "POST",
      signal,
      headers: { "xi-api-key": key, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ inputs, model_id: model, language_code: "ru", ...(seed === undefined ? {} : { seed }) }),
    });
    const text = await res.text();
    if (res.ok) {
      const json = JSON.parse(text) as { audio_base64: string; alignment: Alignment | null; normalized_alignment: Alignment | null; voice_segments: VoiceSegment[] };
      const alignment = json.alignment ?? json.normalized_alignment;
      if (!alignment || !json.voice_segments?.length) throw new Error("ElevenLabs не вернул тайминги диалога");
      return { audio: Buffer.from(json.audio_base64, "base64"), alignment, segments: json.voice_segments, characters: Number(res.headers.get("character-cost") ?? 0) };
    }
    lastError = `ElevenLabs ${res.status}: ${text.slice(0, 300)}`;
    // too many concurrent requests or a passing server error: wait and try again
    if (res.status === 429 || res.status >= 500) {
      await sleep(4000 * (attempt + 1));
      continue;
    }
    break;
  }
  throw new Error(lastError || "ElevenLabs не ответил");
};

/**
 * How one cast member is synthesized line by line (cast.json "tts"), instead of the shared v3 dialogue take.
 * Only the settings given are sent: eleven_v3 takes stability and similarity, the line models take all of them.
 * loudness is the member's level in the joined track (LUFS), applied after synthesis.
 * tempo and sts make the owner's voice of «Новости» (news/runner/pipeline/voice.ts): the read line is sped up by
 * tempo and passed through speech-to-speech in the same voice — the reading gives the stresses, sts the timbre.
 */
export type LineSettings = {
  model: string;
  speed?: number;
  stability?: number;
  similarity?: number;
  style?: number;
  boost?: boolean;
  seed?: number;
  loudness?: number;
  tempo?: number;
  sts?: StsSettings;
};
export type StsSettings = { model: string; stability?: number; similarity?: number };
export type LineResult = { audio: Buffer; alignment: Alignment; characters: number };

/** eleven_v3 performs audio tags ([excited], [gasps]…) but refuses the neighbouring lines as context. */
export const performsTags = (model: string) => model === "eleven_v3";

/**
 * One line in one voice with letter timings. For the line models the neighbouring lines go along as context,
 * so the intonation continues the conversation instead of starting a new reading each time.
 */
export const speakLine = async (text: string, voiceId: string, s: LineSettings, context: { previous?: string; next?: string }, signal?: AbortSignal): Promise<LineResult> => {
  const key = elevenKey();
  const settings = { stability: s.stability, similarity_boost: s.similarity, style: s.style, use_speaker_boost: s.boost, speed: s.speed };
  const body = {
    text,
    model_id: s.model,
    voice_settings: Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined)),
    // the owner picked the voices by one heard take: the same seed keeps a re-run sounding like it
    ...(s.seed === undefined ? {} : { seed: s.seed }),
    ...(context.previous && !performsTags(s.model) ? { previous_text: context.previous } : {}),
    ...(context.next && !performsTags(s.model) ? { next_text: context.next } : {}),
  };
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      signal,
      headers: { "xi-api-key": key, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (res.ok) {
      const json = JSON.parse(raw) as { audio_base64: string; alignment: Alignment | null; normalized_alignment: Alignment | null };
      const alignment = json.alignment ?? json.normalized_alignment;
      if (!alignment) throw new Error("ElevenLabs не вернул тайминги реплики");
      return { audio: Buffer.from(json.audio_base64, "base64"), alignment, characters: Number(res.headers.get("character-cost") ?? text.length) };
    }
    lastError = `ElevenLabs ${res.status}: ${raw.slice(0, 300)}`;
    // too many concurrent requests or a passing server error: wait and try again
    if (res.status === 429 || res.status >= 500) {
      await sleep(4000 * (attempt + 1));
      continue;
    }
    break;
  }
  throw new Error(lastError || "ElevenLabs не ответил");
};

/** The same speech in voiceId: intonation, stresses and timing stay the recording's, the timbre is the voice's. */
export const speechToSpeech = async (wav: Buffer, voiceId: string, s: StsSettings, signal?: AbortSignal): Promise<Buffer> => {
  const key = elevenKey();
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "line.wav");
    form.append("model_id", s.model);
    form.append("voice_settings", JSON.stringify({ stability: s.stability ?? 0.5, similarity_boost: s.similarity ?? 0.9, style: 0, use_speaker_boost: true }));
    form.append("remove_background_noise", "false");
    const res = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}?output_format=mp3_44100_128`, { method: "POST", signal, headers: { "xi-api-key": key }, body: form });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    lastError = `ElevenLabs «речь в речь» ${res.status}: ${(await res.text()).slice(0, 300)}`;
    if (res.status === 429 || res.status >= 500) {
      await sleep(4000 * (attempt + 1));
      continue;
    }
    break;
  }
  throw new Error(lastError || "ElevenLabs «речь в речь» не ответил");
};

/** Forced alignment's answer: every character and word of the text with its time in the audio, in seconds. */
export type AlignedText = { characters: { text: string; start: number; end: number }[]; words: { text: string; start: number; end: number; loss?: number }[]; loss?: number };

const MIME: Record<string, string> = { ".flac": "audio/flac", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".webm": "audio/webm", ".m4a": "audio/mp4" };

/**
 * Letter timings of a known text in a recording (the owner's own take of a line): the same kind of timings
 * the line voices return, so lips and subtitles follow his recording too. Billed by audio length, not by text.
 */
export const alignAudio = async (file: string, text: string, signal?: AbortSignal): Promise<AlignedText> => {
  const key = elevenKey();
  const audio = fs.readFileSync(file);
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    // a fresh form each attempt: a request body is consumed by the first send
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" }), path.basename(file));
    form.append("text", text);
    const res = await fetch("https://api.elevenlabs.io/v1/forced-alignment", { method: "POST", signal, headers: { "xi-api-key": key }, body: form });
    const raw = await res.text();
    if (res.ok) {
      const json = JSON.parse(raw) as Partial<AlignedText>;
      if (!Array.isArray(json.characters) || !json.characters.length) throw new Error("ElevenLabs не вернул тайминги букв записи");
      return { characters: json.characters, words: Array.isArray(json.words) ? json.words : [], loss: json.loss };
    }
    lastError = `ElevenLabs ${res.status}: ${raw.slice(0, 300)}`;
    if (res.status === 429 || res.status >= 500) {
      await sleep(4000 * (attempt + 1));
      continue;
    }
    break;
  }
  throw new Error(lastError || "ElevenLabs не ответил");
};

/** Plain text-to-speech of one voice, for samples. */
export const speak = async (text: string, voiceId: string, stability?: number): Promise<Buffer> => {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ text, model_id: process.env.STUDIO3D_VOICE_MODEL || "eleven_v3", language_code: "ru", ...(stability === undefined ? {} : { voice_settings: { stability } }) }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
};
