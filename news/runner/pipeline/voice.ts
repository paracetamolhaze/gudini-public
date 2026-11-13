// Шаг 4: голоса. Автор — текст читает eleven_v3 клоном владельца одним запросом (короткие куски v3 звучат иначе),
// несколько дублей, берём ближайший к образцу; чтение чуть быстрее, затем «речь в речь» тем же клоном. Герой — другим
// голосом своего пола, тоже одним запросом.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ClipInfo } from "./analyze";
import type { Draft } from "./plan";
import { duration, ffmpeg, loudness, mapLimit, MEDIA_ROOT, python, readJson, splitWords, writeJson, type Hooks } from "./util";

export type VoicedLine = { file: string; words: { w: string; s: number; e: number }[]; end: number; speaker: "narrator" | "hero" };

// «Owner news v3 clean» (28.10): клон из трёх записей владельца с главной, очищенных Voice Isolator. Владелец о прежнем:
// «мой голос тупо ии»; v2 со скоростью ему понравилась, но «не там ударения ставит» — поэтому читает v3 (ударения
// верные), а тембр и чистоту даёт «речь в речь» (проба D, выбрана с ускорением ×1,1).
const OWNER_VOICE = process.env.NEWS_NARRATOR_VOICE || "9tZJ3OSNeIG8jAQ6FQga";
/** Чтение v3 ускоряется до «речи в речь»: она заново собирает голос, и призвук растяжки до ролика не доходит. */
const NARRATOR_TEMPO = 1.1;
// Ekaterina и Max — русские голоса библиотеки ElevenLabs для чужих реплик
const HERO_VOICE = { female: process.env.NEWS_FEMALE_VOICE || "GN4wbsbejSnGSa1AzjH5", male: process.env.NEWS_MALE_VOICE || "lcbtvdFBqqCNU6t9VIr1" };
// одна озвучка; вторая — только если ElevenLabs проглотил слово (владелец 7.11: «озвучивал 4 раза? зачем, пусть
// 1 раз качественно делает» — четыре дубля съедали вчетверо больше кредитов)
const SEEDS = [101, 202];
/** Запросов к ElevenLabs разом: столько держит тариф. */
const TTS_AT_ONCE = 3;

const key = () => {
  const k = process.env.ELEVENLABS_API_KEY?.trim();
  if (!k) throw new Error("Нет ключа ElevenLabs (ELEVENLABS_API_KEY)");
  return k;
};

/**
 * Запросы к ElevenLabs из всех шагов — не больше TTS_AT_ONCE разом: голос автора и перевод героя озвучиваются
 * одновременно (владелец 1.11: «может параллельно всё делать?») и делят места тарифа, а не ждут друг друга.
 */
let inFlight = 0;
const queue: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (inFlight >= TTS_AT_ONCE) await new Promise<void>((resolve) => queue.push(resolve));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    queue.shift()?.();
  }
}

/**
 * Запрос к ElevenLabs с повтором через 5, 10, 15… с: на 429, 5xx и обрыв связи. Обрыв на пяти роликах разом («Client
 * network socket disconnected before secure TLS connection was established», 1.11, Казашка и Хайди Клум) ронял весь
 * ролик: прежде повторялись только ответы 429 и 5xx. body — заново на каждую попытку.
 */
async function request(url: string, body: () => BodyInit, headers: Record<string, string>, what: string, signal?: AbortSignal): Promise<Buffer> {
  let last = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await slot(async () => {
      try {
        const r = await fetch(url, { method: "POST", signal, headers: { "xi-api-key": key(), ...headers }, body: body() });
        return { status: r.status, data: Buffer.from(await r.arrayBuffer()) };
      } catch (error) {
        if (signal?.aborted) throw error;
        return { status: 0, data: Buffer.from(`нет связи: ${(error as Error).message}`) };
      }
    });
    if (res.status >= 200 && res.status < 300) return res.data;
    last = `${res.status || ""} ${res.data.toString("utf8").slice(0, 200)}`.trim();
    if (res.status && res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error(`${what}: ${last || "не ответил"}`);
}

async function tts(text: string, voice: string, body: Record<string, unknown>, out: string, signal?: AbortSignal) {
  const data = await request(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, () => JSON.stringify({ text, ...body }), { "Content-Type": "application/json; charset=utf-8" }, "ElevenLabs", signal);
  fs.writeFileSync(out, data);
}

/** Та же запись голосом voice: интонация, ударения и темп — от записи, тембр — от голоса. */
async function speechToSpeech(input: string, voice: string, out: string, signal?: AbortSignal) {
  const form = () => {
    const f = new FormData();
    f.append("audio", new Blob([fs.readFileSync(input)], { type: "audio/wav" }), "in.wav");
    f.append("model_id", "eleven_multilingual_sts_v2");
    f.append("voice_settings", JSON.stringify({ stability: 0.5, similarity_boost: 0.9, style: 0, use_speaker_boost: true }));
    f.append("remove_background_noise", "false");
    return f;
  };
  fs.writeFileSync(out, await request(`https://api.elevenlabs.io/v1/speech-to-speech/${voice}?output_format=mp3_44100_128`, form, {}, "ElevenLabs «речь в речь»", signal));
}

/** Тайминги слов готовой записи по известному тексту. */
async function align(file: string, text: string, signal?: AbortSignal): Promise<{ w: string; s: number; e: number }[]> {
  const form = () => {
    const f = new FormData();
    f.append("file", new Blob([fs.readFileSync(file)], { type: "audio/mpeg" }), "a.mp3");
    f.append("text", text);
    return f;
  };
  const body = (await request("https://api.elevenlabs.io/v1/forced-alignment", form, {}, "Выравнивание ElevenLabs", signal)).toString("utf8");
  return (JSON.parse(body).words as { text: string; start: number; end: number }[]).filter((w) => w.text.trim()).map((w) => ({ w: w.text.trim(), s: w.start, e: w.end }));
}

/** Режет одну запись на куски по числу слов: граница — середина паузы между словами. */
async function cut(take: string, words: { w: string; s: number; e: number }[], pieces: { id: string; n: number }[], dir: string, speaker: VoicedLine["speaker"], signal?: AbortSignal): Promise<Record<string, VoicedLine>> {
  const total = await duration(take);
  const out: Record<string, VoicedLine> = {};
  let i = 0;
  for (const { id, n } of pieces) {
    const ws = words.slice(i, i + n);
    const prev = words[i - 1];
    const next = words[i + n];
    const start = prev ? Math.max((prev.e + ws[0].s) / 2, ws[0].s - 0.15) : 0;
    const end = next ? Math.min((ws[n - 1].e + next.s) / 2, ws[n - 1].e + 0.25) : Math.min(total, ws[n - 1].e + 0.3);
    const file = path.join(dir, `${id}.mp3`);
    await ffmpeg(["-ss", start.toFixed(3), "-to", end.toFixed(3), "-i", take, "-c:a", "libmp3lame", "-b:a", "192k", file], signal);
    out[id] = { file: `vo/${id}.mp3`, words: ws.map((w) => ({ w: w.w, s: +(w.s - start).toFixed(3), e: +(w.e - start).toFixed(3) })), end: +(ws[n - 1].e - start).toFixed(3), speaker };
    i += n;
  }
  if (i !== words.length) throw new Error(`Слов в записи ${words.length}, а в тексте ${i}: выравнивание не сошлось`);
  return out;
}

/** Реплики в порядке, в котором они звучат в ролике. */
function order(draft: Draft) {
  const narr: string[] = [];
  const hero: string[] = [];
  for (const s of draft.segments) {
    if (s.type === "narr" && !narr.includes(s.line)) narr.push(s.line);
    if (s.type === "dub") for (const l of s.lines) if (!hero.includes(l.line)) hero.push(l.line);
  }
  return { narr, hero };
}

/**
 * Голос автора: весь текст одним запросом, несколько дублей, лучший по тембру к образцу; лучший — быстрее на
 * NARRATOR_TEMPO и «речью в речь» тем же клоном; режется на реплики по словам. matchLufs — громкость, к которой
 * подогнать запись до нарезки (переозвучка ставит новый голос на громкость прежнего).
 */
export async function voiceNarration(blocks: { id: string; text: string }[], takes: string, dir: string, hooks: Hooks, matchLufs?: number): Promise<{ lines: Record<string, VoicedLine>; take: string }> {
  fs.mkdirSync(takes, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  const full = blocks.map((b) => b.text).join(" ");
  await hooks.step("Озвучиваем текст", 50);
  // дубль помнит свой текст: после правки реплики старый дубль не годится (29.10 огурец вышел со старым голосом
  // «огурец действительно тот самый» под новыми субтитрами «он уверяет»)
  const textKey = crypto.createHash("sha1").update(full).digest("hex").slice(0, 10);
  // дубль, где слышны все слова: ElevenLabs иногда глотает слово (владелец 1.11: «вот эта казашка» — «слышится казака»).
  // Первый дубль годится — второй не заказываем; оба с пропусками — берём тот, где пропусков меньше
  const textFile = path.join(takes, `narr_${textKey}.txt`);
  fs.writeFileSync(textFile, full);
  const missedIn = async (f: string): Promise<string[]> => {
    try {
      const heard = JSON.parse((await python("heard.py", [textFile, f], hooks.signal)).trim().split("\n").pop() ?? "[]") as { file: string; missed: string[] }[];
      return heard[0]?.missed ?? [];
    } catch (error) {
      hooks.log(`проверка дубля на слух не прошла: ${(error as Error).message.slice(0, 160)}`);
      return [];
    }
  };
  let best: { file: string; missed: string[] } | null = null;
  for (const seed of SEEDS) {
    const f = path.join(takes, `narr_${textKey}_${seed}.mp3`);
    if (!fs.existsSync(f)) await tts(full, OWNER_VOICE, { model_id: "eleven_v3", language_code: "ru", seed, voice_settings: { stability: 0.5, similarity_boost: 0.8 } }, f, hooks.signal);
    const missed = await missedIn(f);
    hooks.log(`на слух: ${path.basename(f)} — ${missed.join(", ") || "всё слышно"}`);
    if (!best || missed.length < best.missed.length) best = { file: f, missed };
    if (!missed.length) break;
  }
  await hooks.step("Голос автора: темп и тембр", 62);
  const fast = path.join(takes, "narr_fast.wav");
  await ffmpeg(["-i", best!.file, "-af", `rubberband=tempo=${NARRATOR_TEMPO}:pitchq=quality:formant=preserved`, "-ar", "44100", fast], hooks.signal);
  let take = path.join(takes, "narr_sts.mp3");
  await speechToSpeech(fast, OWNER_VOICE, take, hooks.signal);
  const gainDb = matchLufs === undefined ? 0 : matchLufs - (await loudness(take));
  if (Math.abs(gainDb) > 0.1) {
    const level = path.join(takes, "narr_level.mp3");
    await ffmpeg(["-i", take, "-af", `volume=${gainDb.toFixed(2)}dB`, "-c:a", "libmp3lame", "-b:a", "192k", level], hooks.signal);
    take = level;
  }
  const words = await align(take, full, hooks.signal);
  return { lines: await cut(take, words, blocks.map((b) => ({ id: b.id, n: splitWords(b.text).length })), dir, "narrator", hooks.signal), take };
}

/**
 * Сколько секунд у строки перевода: от начала фразы героя до конца того, что он говорит до следующей строки
 * (по расшифровке ролика) — перевод должен идти вместе с ним, а не кончаться раньше. null — расшифровки нет.
 */
function heroWindows(draft: Draft, clips: ClipInfo[]): Map<string, number> {
  const out = new Map<string, number>();
  const byKey = new Map(clips.map((c) => [c.key, c]));
  for (const s of draft.segments) {
    if (s.type !== "dub") continue;
    const phrases = byKey.get(s.clip)?.transcript.phrases ?? [];
    const lines = [...s.lines].sort((a, b) => a.at - b.at);
    lines.forEach((l, i) => {
      const start = s.from + l.at;
      const until = i + 1 < lines.length ? s.from + lines[i + 1].at : s.to;
      const spoken = phrases.filter((p) => p.s >= start - 0.4 && p.s < until - 0.1).reduce((end, p) => Math.max(end, Math.min(p.e, until)), 0);
      const window = Math.min(spoken - start, until - start - 0.15);
      if (window > 0.6) out.set(l.line, window);
    });
  }
  return out;
}

/** Строка героя под длину его фразы: скорость ElevenLabs 0,8–1,2 (дальше голос ломается), один перезапрос. */
async function fitHeroLine(text: string, voiceId: string, target: number | undefined, file: string, signal?: AbortSignal) {
  const settings = { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true };
  await tts(text, voiceId, { model_id: "eleven_multilingual_v2", voice_settings: settings }, file, signal);
  if (!target) return;
  const spoken = await duration(file);
  const ratio = spoken / target;
  if (ratio > 0.88 && ratio < 1.08) return;
  const speed = Math.min(1.2, Math.max(0.8, ratio));
  await tts(text, voiceId, { model_id: "eleven_multilingual_v2", voice_settings: { ...settings, speed: +speed.toFixed(2) } }, file, signal);
}

/**
 * Одна реплика героя заново (runner/edit.ts say): тем же голосом перевода, под прежнюю длину и громкость. Знак ударения
 * (U+0301) в тексте слышит голос, в субтитры он не идёт (владелец 10.11: «лысая» прозвучало с неверным ударением).
 */
export async function voiceHeroLine(id: string, text: string, gender: "female" | "male", target: number | undefined, takes: string, dir: string, matchLufs: number, signal?: AbortSignal): Promise<VoicedLine> {
  fs.mkdirSync(takes, { recursive: true });
  const take = path.join(takes, `${id}_again.mp3`);
  await fitHeroLine(text, HERO_VOICE[gender], target, take, signal);
  const level = path.join(takes, `${id}_again_level.mp3`);
  await ffmpeg(["-i", take, "-af", `volume=${(matchLufs - (await loudness(take))).toFixed(2)}dB`, "-c:a", "libmp3lame", "-b:a", "192k", level], signal);
  const plain = text.replace(/́/g, "");
  const voiced = await cut(level, await align(level, plain, signal), [{ id, n: splitWords(plain).length }], dir, "hero", signal);
  return voiced[id];
}

export async function voice(workDir: string, draft: Draft, gender: "female" | "male", hooks: Hooks, clips: ClipInfo[] = []): Promise<Record<string, VoicedLine>> {
  const cached = path.join(workDir, "voices.json");
  if (fs.existsSync(cached)) return readJson<Record<string, VoicedLine>>(cached);
  const dir = path.join(workDir, "vo");
  const takes = path.join(workDir, "takes");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(takes, { recursive: true });
  const text = new Map([...draft.narration, ...draft.heroLines].map((l) => [l.id, l.text.trim()]));
  // чужая реплика в ролике героя (пост жены, ответ коллеги) — голосом её пола
  const heroGender = new Map(draft.heroLines.map((l) => [l.id, l.voice === "female" || l.voice === "male" ? l.voice : gender]));
  const { narr, hero } = order(draft);

  // герой: перевод другим голосом своего пола, каждая строка под длину его фразы (владелец 28.10: «озвучка автора
  // видео идёт быстрее, чем он говорит, подгонять нельзя?»); озвучивается одновременно с автором (1.11), громкость
  // подгоняется под автора, когда выбран его дубль
  const windows = heroWindows(draft, clips);
  const heroTakes = mapLimit(hero, TTS_AT_ONCE, async (id) => {
    // как у голоса автора: дубль помнит свой текст и длину окна
    const key = crypto.createHash("sha1").update(`${text.get(id)}|${windows.get(id) ?? ""}|${heroGender.get(id)}`).digest("hex").slice(0, 10);
    const take = path.join(takes, `${id}_${key}.mp3`);
    if (!fs.existsSync(take)) await fitHeroLine(text.get(id)!, HERO_VOICE[heroGender.get(id) ?? gender], windows.get(id), take, hooks.signal);
    return take;
  });
  // ошибка перевода всплывёт ниже, когда его дождутся; без этого Node счёл бы её необработанной, пока идёт голос автора
  heroTakes.catch(() => {});

  const { lines, take: best } = await voiceNarration(narr.map((id) => ({ id, text: text.get(id)! })), takes, dir, hooks);

  if (hero.length) {
    await hooks.step("Озвучиваем перевод героя", 64);
    const taken = await heroTakes;
    const narratorLufs = await loudness(best);
    // строки перевода независимы — разом
    const voiced = await mapLimit(hero, TTS_AT_ONCE, async (id, i) => {
      const take = taken[i];
      const level = path.join(takes, `${id}_level.mp3`);
      await ffmpeg(["-i", take, "-af", `volume=${(narratorLufs - (await loudness(take))).toFixed(2)}dB`, "-c:a", "libmp3lame", "-b:a", "192k", level], hooks.signal);
      return cut(level, await align(level, text.get(id)!, hooks.signal), [{ id, n: splitWords(text.get(id)!).length }], dir, "hero", hooks.signal);
    });
    for (const [i, id] of hero.entries()) {
      Object.assign(lines, voiced[i]);
      const target = windows.get(id);
      hooks.log(`перевод ${id}: ${lines[id].end.toFixed(1)} с${target ? ` под фразу героя ${target.toFixed(1)} с` : ""}`);
    }
  }
  writeJson(cached, lines);
  return lines;
}
