/** Normalize punctuation while preserving links exactly. */
export function normalizeThreadsText(input: string): string {
  return input.split(/(https?:\/\/[^\s]+)/g).map(part => /^https?:\/\//.test(part) ? part : part.replace(/[\u2012-\u2015]/g, '-')).join('');
}

/**
 * Пост Threads без хештегов и без темы: владелец 25.10 — «в тредс не нужны хештеги». Решётки, если
 * модель их всё же поставила, снимаются с текста, а хвост из тегов в конце убирается целиком.
 * X здесь не обрабатывается.
 */
export function prepareThreadsPost(input: string): { text: string } {
  input = normalizeThreadsText(input);
  const trailing = input.match(/(?:^|\s)#[\p{L}\p{N}_]+(?:\s+#[\p{L}\p{N}_]+)*\s*$/u)?.[0] ?? '';
  // Preserve inline words and URL fragments; remove only hashtag markers at word boundaries.
  const text = (trailing ? input.slice(0,-trailing.length) : input).replace(/(^|\s)#([\p{L}\p{N}_]+)/gu,'$1$2').trim();
  return {text};
}
