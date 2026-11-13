import { jsonOf } from "./bridge";

/** Applies exact, independent replacements against the original file, never against earlier edits. */
export function applyPatch(code: string, answer: string): string {
  let parsed: { edits?: unknown };
  try {
    // a ```json fence first: review prose quotes JSX like from={1.6}, and its braces must not break the parse
    parsed = jsonOf<{ edits?: unknown }>(answer);
  } catch {
    throw new Error("Правки должны быть JSON с edits");
  }
  if (!parsed || !Array.isArray(parsed.edits) || parsed.edits.length > 40) throw new Error("Правки: нужен массив edits, не больше 40 замен");
  const edits = parsed.edits
    .map((edit: unknown) => {
      const e = edit as { before?: unknown; after?: unknown; reason?: unknown } | null;
      if (!e || typeof e.before !== "string" || !e.before || e.before.length > 12000 || typeof e.after !== "string" || e.after.length > 12000) {
        throw new Error("Правка: нужны непустой before и строка after, до 12000 знаков");
      }
      const at = code.indexOf(e.before);
      if (at < 0 || code.indexOf(e.before, at + 1) >= 0) throw new Error(`before должен встречаться в файле ровно один раз: ${e.before.slice(0, 80)}`);
      return { start: at, end: at + e.before.length, after: e.after };
    })
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) {
    if (edits[i].start < edits[i - 1].end) throw new Error("Фрагменты правок пересекаются");
  }
  let result = code;
  for (const e of [...edits].reverse()) result = result.slice(0, e.start) + e.after + result.slice(e.end);
  return result;
}
