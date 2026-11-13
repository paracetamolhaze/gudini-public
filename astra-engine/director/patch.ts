/** Apply exact, independent replacements against the original file, never against earlier edits. */
export function applyMontagePatch(code: string, answer: string): string {
  const json = answer.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1");
  let parsed: { edits?: unknown };
  try { parsed = JSON.parse(json); } catch { throw new Error("Правки должны быть валидным JSON с edits"); }
  if (!parsed || !Array.isArray(parsed.edits) || parsed.edits.length > 32) throw new Error("Правки: нужен массив edits, не больше 32 замен");
  const edits = parsed.edits.map((edit: unknown) => {
    const e = edit as { before?: unknown; after?: unknown; reason?: unknown } | null;
    if (!e || typeof e.before !== "string" || !e.before || e.before.length > 12000 || typeof e.after !== "string" || e.after.length > 12000 || typeof e.reason !== "string" || !e.reason.trim()) {
      throw new Error("Правка: нужны непустые before, reason и строка after; до 12000 знаков на фрагмент");
    }
    const start = code.indexOf(e.before);
    if (start < 0 || code.indexOf(e.before, start + 1) >= 0) throw new Error("before должен встречаться в исходном файле ровно один раз");
    return { start, end: start + e.before.length, after: e.after };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) {
    if (edits[i].start < edits[i - 1].end) throw new Error("Фрагменты правок пересекаются");
  }
  const replaced = edits.reduce((n, e) => n + e.end - e.start, 0);
  if (code.length > 2000 && replaced > code.length * 0.8) throw new Error("Правки заменяют почти весь файл: нужны локальные фрагменты");
  let result = code;
  for (const e of edits.reverse()) result = result.slice(0, e.start) + e.after + result.slice(e.end);
  return result;
}
