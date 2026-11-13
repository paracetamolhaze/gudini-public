import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CastFile } from "./cast";
import type { AlignedText } from "./elevenlabs";
import { hasWords, spokenText, voiceByLines, voiceLineClips } from "./lineVoice";
import { voicedLines } from "./mouth";
import { decodeMono, evenAlignment, prepareRecording, RATE, speechBounds, speechRuns, toAlignment, trimToSpeech } from "./recorded";
import { voiceScript } from "./voice";

const run = promisify(execFile);
// no test may reach the real key, and every request below goes to a stub
process.env.ELEVENLABS_API_KEY = "test-key";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "studio3d-rec-"));

/**
 * A take like a browser recording: stereo 48 kHz, faint room noise, a click of the record button at 0.2 s,
 * a tone from `from` to `to` seconds at `amp`, then silence.
 */
async function take(file: string, amp: number, from = 0.6, to = 1.8, total = 2.6, hz = 220) {
  const expr = `0.0003*(random(0)-0.5)+if(between(t,0.2,0.21),0.4,0)+if(between(t,${from},${to}),${amp}*sin(2*PI*${hz}*t),0)`;
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc='${expr}':s=48000:d=${total}`, "-ac", "2", file]);
  return file;
}

/**
 * A long mono take around one short word (a syllable-like tone from `from` for `seconds`): the owner forgot to press
 * stop. noise is the room's level (0 means digital silence, as with noise suppression on).
 */
async function longTake(file: string, { from = 12, seconds = 0.45, amp = 0.1, noise = 0, total = 25 } = {}) {
  const word = `if(between(t,${from},${from + seconds}),${amp}*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*5*t)),0)`;
  const expr = noise ? `${noise}*(random(0)-0.5)+${word}` : word;
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc='${expr}':s=48000:d=${total}`, "-ac", "1", "-c:a", "flac", "-sample_fmt", "s16", file]);
  return file;
}

const rmsDb = (s: Float32Array) => 10 * Math.log10(s.reduce((sum, v) => sum + v * v, 0) / s.length + 1e-12);

/** A distinct sha256-looking id per take (the cache is named by its first 16 hex digits). */
const sha = (n: number) => createHash("sha256").update(String(n)).digest("hex");

const loudness = async (samples: Float32Array) => {
  const dir = tmp();
  const file = path.join(dir, "s.f32");
  fs.writeFileSync(file, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  try {
    const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", file, "-af", "ebur128=framelog=verbose", "-f", "null", "-"]);
    const all = [...stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
    return Number(all[all.length - 1][1]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** Replaces fetch for one test; every request is recorded with its URL, headers and body. */
function stubFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return answer(url, init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

/** What forced alignment returns for a text read evenly from `start` over `seconds`, spaces included. */
const aligned = (text: string, start: number, seconds: number): AlignedText => {
  const chars = [...text];
  const step = seconds / chars.length;
  return { characters: chars.map((ch, i) => ({ text: ch, start: start + i * step, end: start + (i + 1) * step })), words: [], loss: 0.1 };
};

test("speech bounds are relative to the take: a quiet and a loud take give the same cut, the button click is ignored", async () => {
  const dir = tmp();
  try {
    for (const amp of [0.015, 0.6]) {
      const samples = await decodeMono(await take(path.join(dir, `t${amp}.flac`), amp), undefined);
      const bounds = speechBounds(samples);
      assert.ok(bounds, `речь найдена при амплитуде ${amp}`);
      assert.ok(Math.abs(bounds[0] - 0.6) <= 0.03 && Math.abs(bounds[1] - 1.8) <= 0.03, `границы ${bounds} при амплитуде ${amp}`);
      const trimmed = trimToSpeech(samples, bounds);
      assert.ok(Math.abs(trimmed.length / RATE - (bounds[1] - bounds[0] + 0.16)) < 0.005, "по 0.08 с воздуха с краёв");
      assert.ok(Math.abs(trimmed[0]) < 1e-6 && Math.abs(trimmed[trimmed.length - 1]) < 1e-6, "края без щелчка");
    }
    assert.equal(speechBounds(new Float32Array(RATE)), null, "тишина — не речь");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("speech runs: every stretch of speech apart, by speechBounds' own threshold, at any mic level; the button click is none", () => {
  for (const amp of [0.015, 0.6]) {
    // faint room noise, the record button at 0.2 s, two words 0.6–1.0 and 1.25–1.8 s
    const x = Float32Array.from({ length: Math.round(2.6 * RATE) }, (_, n) => {
      const t = n / RATE;
      const word = (t >= 0.6 && t < 1.0) || (t >= 1.25 && t < 1.8) ? amp * Math.sin(2 * Math.PI * 220 * t) : 0;
      return 0.0003 * (((n * 9301 + 49297) % 233280) / 233280 - 0.5) + (t >= 0.2 && t < 0.21 ? 0.4 : 0) + word;
    });
    const runs = speechRuns(x);
    assert.equal(runs.length, 2, `два слова при амплитуде ${amp}: ${JSON.stringify(runs)}`);
    [[0.6, 1.0], [1.25, 1.8]].forEach(([a, b], k) => assert.ok(Math.abs(runs[k][0] - a) <= 0.02 && Math.abs(runs[k][1] - b) <= 0.02, `слово ${k + 1}: ${runs[k]}`));
    const bounds = speechBounds(x);
    assert.ok(bounds && Math.abs(bounds[0] - runs[0][0]) <= 0.02 && Math.abs(bounds[1] - runs[1][1]) <= 0.02, `те же границы, что у speechBounds: ${bounds}`);
  }
  assert.deepEqual(speechRuns(new Float32Array(RATE)), [], "тишина — не речь");
});

test("one short word in a long take is found and cut out, in digital silence and in room noise; noise or a click alone is no speech", async () => {
  const dir = tmp();
  try {
    // 12 s on each side of the word: it is under 2% of the take
    for (const [name, noise] of [["silence", 0], ["hiss", 0.002], ["room", 0.02]] as const) {
      const samples = await decodeMono(await longTake(path.join(dir, `${name}.flac`), { noise, amp: noise >= 0.02 ? 0.3 : 0.1 }));
      const bounds = speechBounds(samples);
      assert.ok(bounds, `слово найдено (${name})`);
      assert.ok(Math.abs(bounds[0] - 12) <= 0.03 && Math.abs(bounds[1] - 12.45) <= 0.03, `границы ${bounds} (${name})`);
      const trimmed = trimToSpeech(samples, bounds);
      assert.ok(trimmed.length / RATE < 0.7, `подрезано до слова: ${trimmed.length / RATE} с (${name})`);
    }
    // a take of room noise only, and one with nothing but the record button's click
    const noise = await decodeMono(await longTake(path.join(dir, "noise.flac"), { amp: 0, noise: 0.02, total: 5 }));
    assert.equal(speechBounds(noise), null, "ровный шум — не речь");
    const click = await decodeMono(await take(path.join(dir, "click.flac"), 0));
    assert.equal(speechBounds(click), null, "щелчок кнопки — не речь");

    // the whole way: a take of one word in silence is prepared, not refused as silent
    const rec = { index: 3, file: path.join(dir, "silence.flac"), sha256: sha(30) };
    const prepared = await prepareRecording(rec, "", path.join(dir, "recorded"));
    assert.ok(Math.abs(prepared.speech[0] - 0.08) < 0.03 && Math.abs(prepared.speech[1] - 0.53) < 0.03, `речь в подрезанной записи ${prepared.speech}`);
    assert.ok(Math.abs((await decodeMono(prepared.file)).length / RATE - 0.61) < 0.04);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the aligner's answer becomes the text's own characters, so words split at the spaces", () => {
  const text = "Ну, привет мир!";
  const full = toAlignment(text, aligned(text, 0.1, 1.5), 2)!;
  assert.deepEqual(full.characters, [...text]);
  // an answer without spaces and punctuation still gives every character of the text a time
  const bare = toAlignment(text, { characters: [...text].filter(ch => /\p{L}/u.test(ch)).map((ch, i) => ({ text: ch, start: 0.1 + i * 0.1, end: 0.2 + i * 0.1 })), words: [] }, 2)!;
  assert.deepEqual(bare.characters, [...text]);
  const segment = { voice_id: "v", start_time_seconds: 0, end_time_seconds: 2, character_start_index: 0, character_end_index: text.length, dialogue_input_index: 0 };
  const [line] = voicedLines(bare, [segment], () => "me");
  assert.deepEqual(line.words.map(w => w.text), ["Ну,", "привет", "мир!"]);
  assert.ok(line.words.every((w, i) => i === 0 || w.start >= line.words[i - 1].end - 1e-9), "слова идут по порядку");
  for (let i = 1; i < bare.characters.length; i++) assert.ok(bare.character_start_times_seconds[i] >= bare.character_start_times_seconds[i - 1]);
  // times outside the take are clamped to it
  const late = toAlignment("да", { characters: [{ text: "д", start: 1.9, end: 2.5 }, { text: "а", start: 2.5, end: 3 }], words: [] }, 2)!;
  assert.deepEqual(late.character_end_times_seconds, [2, 2]);
  assert.equal(toAlignment(text, { characters: [{ text: "x", start: 0, end: 1 }], words: [] }, 2), null, "чужой текст — не тайминги");
  const even = evenAlignment("абв", [1, 1.3]);
  assert.deepEqual(even.character_start_times_seconds.map(t => Math.round(t * 100) / 100), [1, 1.1, 1.2]);
});

test("a recording is prepared once per take: trimmed, aligned by ElevenLabs, cached by sha256; a failed alignment spreads the letters", async () => {
  const dir = tmp();
  const text = "Что такое сид-фраза?";
  const stub = stubFetch(async (url, init) => {
    const form = init.body as FormData;
    const file = form.get("file") as File;
    assert.ok(file.size > 1000, "отправлена сама запись");
    const said = String(form.get("text"));
    if (said === "сломай") return new Response(JSON.stringify({ detail: "bad" }), { status: 400 });
    return Response.json(aligned(said, 0.09, 1.1));
  });
  try {
    const source = await take(path.join(dir, "dub.flac"), 0.02);
    const rec = { index: 0, file: source, sha256: sha(1) };
    const cache = path.join(dir, "recorded");
    const logs: string[] = [];
    const first = await prepareRecording(rec, text, cache, undefined, m => logs.push(m));
    assert.equal(first.source, "elevenlabs");
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, "https://api.elevenlabs.io/v1/forced-alignment");
    assert.equal((stub.calls[0].init.headers as Record<string, string>)["xi-api-key"], "test-key");
    assert.deepEqual(first.alignment.characters, [...text]);
    assert.ok(path.basename(first.file).startsWith(sha(1).slice(0, 16)));
    const prepared = await decodeMono(first.file);
    assert.ok(Math.abs(prepared.length / RATE - 1.36) < 0.04, `подрезанная запись ${prepared.length / RATE} с`);

    const again = await prepareRecording(rec, text, cache);
    assert.equal(stub.calls.length, 1, "повторный прогон ничего не платит");
    assert.deepEqual(again.alignment, first.alignment);

    // the same take with another text is aligned again; a failure falls back to even letters over the speech, uncached
    const failed = await prepareRecording(rec, "сломай", cache, undefined, m => logs.push(m));
    assert.equal(failed.source, "even");
    assert.ok(logs.some(m => /Выравнивание записи реплики 1 не удалось/.test(m)));
    assert.ok(Math.abs(failed.alignment.character_start_times_seconds[0] - 0.08) < 0.03);
    assert.ok(Math.abs(failed.alignment.character_end_times_seconds.at(-1)! - 1.28) < 0.03);
    await prepareRecording(rec, "сломай", cache);
    assert.equal(stub.calls.length, 3, "неудача не кешируется");

    const silent = path.join(dir, "silent.flac");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "1", silent]);
    await assert.rejects(prepareRecording({ index: 4, file: silent, sha256: sha(2) }, text, cache), /В записи реплики 5 не слышно речи/);
  } finally {
    stub.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lines with a recording play the owner's take, levelled like his voice; Claude's lines keep their context, and a new take makes a new track", async () => {
  const dir = tmp();
  const cast = {
    me: { kind: "human", name: "Ты", voice: "voice-me", look: {}, tts: { model: "eleven_v3", stability: 0.5, loudness: -18 } },
    claude: { kind: "blocky", name: "Клод", color: "#d97757", voice: "voice-claude", tts: { model: "eleven_v4", speed: 0.9, loudness: -22 } },
  } satisfies CastFile;
  const script = {
    title: "Сид",
    lines: [
      { who: "me", text: "[curious] Что такое сид-фраза?" },
      { who: "claude", text: "Двенадцать слов от кошелька." },
      { who: "me", text: "И всё?" },
    ],
  };
  const synth = path.join(dir, "synth.mp3");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=0.9:sample_rate=44100", "-c:a", "libmp3lame", "-b:a", "128k", synth]);
  const synthB64 = fs.readFileSync(synth).toString("base64");
  const stub = stubFetch(async (url, init) => {
    if (url.includes("forced-alignment")) return Response.json(aligned(String((init.body as FormData).get("text")), 0.09, 1.0));
    const body = JSON.parse(String(init.body)) as { text: string };
    const chars = [...body.text];
    const alignment = { characters: chars, character_start_times_seconds: chars.map((_, i) => (i * 0.8) / chars.length), character_end_times_seconds: chars.map((_, i) => ((i + 1) * 0.8) / chars.length) };
    return new Response(JSON.stringify({ audio_base64: synthB64, alignment, normalized_alignment: null }), { status: 200, headers: { "character-cost": String(chars.length) } });
  });
  try {
    const voiceDir = path.join(dir, "voice");
    const quiet = await take(path.join(dir, "quiet.flac"), 0.01);
    const loud = await take(path.join(dir, "loud.flac"), 0.5, 0.6, 1.5, 2.2, 180);
    const recordings = [
      { index: 0, file: quiet, sha256: sha(10) },
      { index: 2, file: loud, sha256: sha(11) },
    ];
    const result = await voiceByLines(script, cast, voiceDir, undefined, undefined, recordings);
    const tts = stub.calls.filter(c => c.url.includes("text-to-speech"));
    assert.equal(tts.length, 1, "синтезирована только реплика Клода");
    assert.match(tts[0].url, /voice-claude/);
    const asked = JSON.parse(String(tts[0].init.body));
    assert.equal(asked.previous_text, spokenText(script.lines[0].text), "контекст Клода — слова сценария, как без записей");
    assert.equal(asked.next_text, "И всё?");
    assert.equal(stub.calls.filter(c => c.url.includes("forced-alignment")).length, 2);

    const segments = result.raw.segments;
    assert.deepEqual(segments.map(s => s.dialogue_input_index), [0, 1, 2]);
    assert.ok(Math.abs(segments[0].end_time_seconds - segments[0].start_time_seconds - 1.36) < 0.04, "первая реплика — подрезанная запись");
    assert.ok(Math.abs(segments[2].end_time_seconds - segments[2].start_time_seconds - 1.06) < 0.04);
    const words = voicedLines(result.raw.alignment, segments, s => script.lines[s.dialogue_input_index].who);
    assert.deepEqual(words[0].words.map(w => w.text), ["Что", "такое", "сид-фраза?"], "теги вычищены, слова по тексту");
    assert.ok(words[0].start >= segments[0].start_time_seconds && words[0].end <= segments[0].end_time_seconds);

    // a quiet take and a loud take (34 dB apart) both end up at the owner's -18 LUFS
    const track = await decodeMono(result.file);
    const slice = (s: (typeof segments)[number]) => track.slice(Math.round(s.start_time_seconds * RATE), Math.round(s.end_time_seconds * RATE));
    for (const s of [segments[0], segments[2]]) {
      const level = await loudness(slice(s));
      assert.ok(Math.abs(level - -18) < 1.5, `реплика ${s.dialogue_input_index + 1} на громкости владельца (${level})`);
    }

    // the same takes again: nothing is paid, the same track; a re-recorded line makes another track
    const calls = stub.calls.length;
    const same = await voiceByLines(script, cast, voiceDir, undefined, undefined, recordings);
    assert.equal(stub.calls.length, calls);
    assert.equal(same.file, result.file);
    const retake = await take(path.join(dir, "retake.flac"), 0.02, 0.4, 1.4, 2);
    const changed = await voiceByLines(script, cast, voiceDir, undefined, undefined, [recordings[0], { index: 2, file: retake, sha256: sha(12) }]);
    assert.notEqual(changed.file, result.file);
    assert.equal(stub.calls.filter(c => c.url.includes("text-to-speech")).length, 1, "реплика Клода из кеша");
  } finally {
    stub.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a one-word take is levelled like the owner's long lines; a silent take of a line without words is left out", async () => {
  const dir = tmp();
  const cast = {
    me: { kind: "human", name: "Ты", voice: "voice-me", look: {}, tts: { model: "eleven_v3", loudness: -18 } },
    claude: { kind: "blocky", name: "Клод", color: "#d97757", voice: "voice-claude", tts: { model: "eleven_v4", loudness: -22 } },
  } satisfies CastFile;
  const script = {
    title: "Т",
    lines: [
      { who: "me", text: "Это длинная реплика про сид-фразу." },
      { who: "claude", text: "Да." },
      { who: "me", text: "Ну!" },
      { who: "me", text: "[pause]" },
      { who: "claude", text: "[sighs]" },
    ],
  };
  const synth = path.join(dir, "synth.mp3");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=0.9:sample_rate=44100", "-c:a", "libmp3lame", synth]);
  const stub = stubFetch(async (url, init) => {
    if (url.includes("forced-alignment")) return Response.json(aligned(String((init.body as FormData).get("text")), 0.08, 0.2));
    const chars = [...(JSON.parse(String(init.body)) as { text: string }).text];
    const alignment = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.05), character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.05) };
    return Response.json({ audio_base64: fs.readFileSync(synth).toString("base64"), alignment });
  });
  try {
    // the same quiet mic for both: a 1.5 s line, and a 0.2 s reply in a 1 s take (0.36 s once trimmed)
    const long = await take(path.join(dir, "long.flac"), 0.02, 0.5, 2.0, 2.5);
    const short = await take(path.join(dir, "short.flac"), 0.02, 0.4, 0.6, 1.0);
    const silent = path.join(dir, "silent.flac");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "1", silent]);
    const logs: string[] = [];
    const recordings = [
      { index: 0, file: long, sha256: sha(40) },
      { index: 2, file: short, sha256: sha(41) },
      { index: 3, file: silent, sha256: sha(42) },
    ];
    const result = await voiceByLines(script, cast, path.join(dir, "voice"), undefined, m => logs.push(m), recordings);
    assert.ok(logs.some(m => /Запись реплики 4 без звука/.test(m)), "пустая запись паузы не останавливает монтаж");
    assert.deepEqual(result.raw.segments.map(s => s.dialogue_input_index), [0, 1, 2], "реплики из одних тегов без звука не занимают места");
    const track = await decodeMono(result.file);
    // the middle of each word, away from the air and the fades
    const words = (n: number) => {
      const s = result.raw.segments.find(seg => seg.dialogue_input_index === n)!;
      return track.slice(Math.round((s.start_time_seconds + 0.12) * RATE), Math.round((s.end_time_seconds - 0.12) * RATE));
    };
    const [longDb, shortDb] = [rmsDb(words(0)), rmsDb(words(2))];
    assert.ok(Math.abs(longDb - shortDb) < 1.5, `короткая реплика на громкости длинной: ${shortDb.toFixed(1)} против ${longDb.toFixed(1)} дБ`);
    assert.ok(longDb > -25, `обе подняты к громкости владельца (${longDb.toFixed(1)} дБ)`);

    // a line with words must not lose its take that way
    await assert.rejects(
      voiceByLines(script, cast, path.join(dir, "voice"), undefined, undefined, [{ index: 2, file: silent, sha256: sha(43) }]),
      /В записи реплики 3 не слышно речи/,
    );
    assert.equal(hasWords("[sighs]"), false);
    assert.equal(hasWords("[pause] ..."), false);
    assert.equal(hasWords("[laughs] Да"), true);
    assert.equal(hasWords("1000?"), true);

    // a two-line sketch whose second line is Claude's «[sighs]» is one spoken line, not an empty take
    const pair = { title: "Т", lines: [script.lines[0], script.lines[4]] };
    const voiced = await voiceScript(pair, cast, path.join(dir, "pair"), undefined, undefined, [recordings[0]]);
    assert.deepEqual(voiced.lines.map(l => l.who), ["me"]);
  } finally {
    stub.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the voice job's clips are the montage's own per-line cache: a montage after it pays nothing", async () => {
  const dir = tmp();
  const cast = {
    me: { kind: "human", name: "Ты", voice: "voice-me", look: {}, tts: { model: "eleven_v3", loudness: -18 } },
    claude: { kind: "blocky", name: "Клод", color: "#d97757", voice: "voice-claude", tts: { model: "eleven_v4", loudness: -22 } },
  } satisfies CastFile;
  const script = { title: "Т", lines: [{ who: "me", text: "Привет." }, { who: "claude", text: "[pause]" }, { who: "claude", text: "Привет, друг." }] };
  const synth = path.join(dir, "synth.mp3");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=0.7:sample_rate=44100", "-c:a", "libmp3lame", synth]);
  const stub = stubFetch(async (_url, init) => {
    const chars = [...(JSON.parse(String(init.body)) as { text: string }).text];
    const alignment = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.05), character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.05) };
    return Response.json({ audio_base64: fs.readFileSync(synth).toString("base64"), alignment });
  });
  try {
    const voiceDir = path.join(dir, "voice");
    const progress: string[] = [];
    const clips = await voiceLineClips(script, cast, voiceDir, undefined, undefined, (done, total) => progress.push(`${done}/${total}`));
    assert.deepEqual(clips.map(c => [c.index, c.who]), [[0, "me"], [2, "claude"]], "реплика из одной паузы не озвучивается");
    assert.ok(clips.every(c => fs.existsSync(c.file) && path.dirname(c.file) === path.join(voiceDir, "lines")));
    assert.ok(clips.every(c => Math.abs(c.duration - 0.7) < 0.08), "длительность самой реплики");
    assert.deepEqual(progress, ["0/2", "1/2", "2/2"]);
    assert.equal(stub.calls.length, 2);
    await voiceByLines(script, cast, voiceDir);
    assert.equal(stub.calls.length, 2, "монтаж после озвучки ничего не платит");
  } finally {
    stub.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
