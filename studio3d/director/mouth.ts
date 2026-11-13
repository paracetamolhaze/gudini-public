/**
 * Turns the voice service's letter timings into what the 3D layer needs:
 * clean words for subtitles and a mouth curve per line, so lips move with the real audio.
 */

export type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
export type VoiceSegment = { voice_id: string; start_time_seconds: number; end_time_seconds: number; character_start_index: number; character_end_index: number; dialogue_input_index: number };
export type VoicedLine = {
  who: string;
  text: string;
  start: number;
  end: number;
  words: { text: string; start: number; end: number }[];
  mouth: [number, number][];
  /** The script line it voices: lines without words are dropped, so a line's place in the list is not its index. */
  index?: number;
};

const OPEN: Record<string, number> = { а: 1, о: 0.95, у: 0.7, ы: 0.65, э: 0.8, е: 0.75, ё: 0.85, и: 0.6, ю: 0.65, я: 0.95, a: 1, o: 0.95, u: 0.7, e: 0.75, i: 0.6, y: 0.6 };
const CLOSED = new Set(["м", "б", "п", "в", "ф", "m", "b", "p", "v", "f"]);

const openness = (ch: string) => {
  const c = ch.toLowerCase();
  if (c in OPEN) return OPEN[c];
  if (CLOSED.has(c)) return 0;
  if (/[a-zа-яё0-9]/i.test(c)) return 0.3;
  return 0;
};

/** Letters with their times, without voice tags like [sighs] that the model performs but nobody reads. */
const spokenLetters = (al: Alignment, from: number, to: number) => {
  const out: { ch: string; start: number; end: number }[] = [];
  let depth = 0;
  for (let i = from; i < to && i < al.characters.length; i++) {
    const ch = al.characters[i];
    if (ch === "[") depth++;
    if (depth === 0) out.push({ ch, start: al.character_start_times_seconds[i], end: al.character_end_times_seconds[i] });
    if (ch === "]") depth = Math.max(0, depth - 1);
  }
  // a tag leaves a double space behind
  return out.filter((l, i) => !(l.ch === " " && (i === 0 || out[i - 1].ch === " ")));
};

export const voicedLines = (al: Alignment, segments: VoiceSegment[], whoOf: (segment: VoiceSegment) => string): VoicedLine[] =>
  segments.map((seg) => {
    const letters = spokenLetters(al, seg.character_start_index, seg.character_end_index);
    const words: VoicedLine["words"] = [];
    let cur: typeof letters = [];
    const flush = () => {
      const text = cur.map((l) => l.ch).join("").trim();
      // a closing "." or "!" is stretched over the silence after the line: the word ends with its last letter
      const last = [...cur].reverse().find((l) => /[\p{L}\p{N}]/u.test(l.ch)) ?? cur[cur.length - 1];
      if (text) words.push({ text, start: cur[0].start, end: last.end });
      cur = [];
    };
    for (const l of letters) {
      if (/\s/.test(l.ch)) flush();
      else cur.push(l);
    }
    flush();
    const mouth: [number, number][] = [];
    for (const l of letters) {
      const v = openness(l.ch);
      mouth.push([l.start, v]);
      if (l.end - l.start > 0.12) mouth.push([l.end - 0.04, v * 0.6]);
    }
    const end = words.length ? words[words.length - 1].end : seg.end_time_seconds;
    mouth.push([end + 0.02, 0]);
    return {
      who: whoOf(seg),
      text: words.map((w) => w.text).join(" "),
      start: words.length ? words[0].start : seg.start_time_seconds,
      end,
      words,
      mouth,
    };
  });
