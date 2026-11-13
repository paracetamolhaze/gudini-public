import { SID_ICONS, type SidContent, type SidIcon, type SidResearch, type SidStep } from "./types";

/**
 * Разбор ответов Claude и проверка содержимого карусели. Ответ модели — данные: каждое поле
 * приводится к строке нужной длины, лишнее отбрасывается, без обязательного — ошибка с причиной.
 */

const NBSP = String.fromCharCode(160);

/** Первый JSON-объект в ответе: модель иногда оборачивает его в ```json или добавляет фразу. */
export function extractJson(text: string): unknown {
  const t = String(text ?? "").trim();
  try {
    return JSON.parse(t);
  } catch {}
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch {}
  }
  throw new Error("Claude ответил не JSON");
}

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const lines = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter(Boolean).slice(0, max) : typeof v === "string" && v.trim() ? [str(v, 80)] : []);

/** Видимая длина: звёздочки **жирного** не считаются. */
export const visible = (s: string) => [...s.replace(/\*\*/g, "")].length;

export function isHttpUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 2000) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function parseResearch(raw: unknown): SidResearch {
  const r = raw as any;
  const topic = str(r?.topic, 200);
  const topicKey = str(r?.topicKey, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!topic || !topicKey) throw new Error("В исследовании нет темы");
  const facts = (Array.isArray(r?.facts) ? r.facts : [])
    .map((f: any, i: number) => ({ id: str(f?.id, 12) || `f${i + 1}`, claim: str(f?.claim, 600), quote: str(f?.quote, 1200), url: str(f?.url, 2000), publisher: str(f?.publisher, 120), date: str(f?.date, 40) || undefined }))
    .filter((f: any) => f.claim && f.quote && isHttpUrl(f.url));
  if (facts.length < 8) throw new Error(`В исследовании ${facts.length} проверяемых фактов с цитатами — нужно не меньше 8`);
  const pages = (Array.isArray(r?.pages) ? r.pages : [])
    .map((p: any) => ({ step: Number(p?.step), url: str(p?.url, 2000), publisher: str(p?.publisher, 120), headline: str(p?.headline, 300) }))
    .filter((p: any) => Number.isInteger(p.step) && p.step >= 1 && p.step <= 7 && isHttpUrl(p.url));
  return { topic, topicKey, angle: str(r?.angle, 1000), facts: facts.slice(0, 40), pages };
}

const ICON_SET = new Set<string>(SID_ICONS);

export function parseContent(raw: unknown, sourcesHint?: SidContent["sources"]): SidContent {
  const r = raw as any;
  const sources = (Array.isArray(r?.sources) ? r.sources : sourcesHint ?? [])
    .map((s: any) => ({ url: str(s?.url, 2000), title: str(s?.title, 300), publisher: str(s?.publisher, 120), date: str(s?.date, 40) || undefined }))
    .filter((s: any) => isHttpUrl(s.url))
    .slice(0, 20);
  if (sources.length < 3) throw new Error("В карусели меньше трёх источников");
  const stepsRaw = Array.isArray(r?.steps) ? r.steps : [];
  if (stepsRaw.length !== 7) throw new Error(`Шагов ${stepsRaw.length} — нужно ровно 7`);
  const steps: SidStep[] = stepsRaw.map((s: any, i: number) => {
    const pills = Array.isArray(s?.pills) ? s.pills : [];
    const pill = (p: any): [string, string] => [str(Array.isArray(p) ? p[0] : p?.label, 30).toUpperCase(), str(Array.isArray(p) ? p[1] : p?.value, 30)];
    const icon = str(s?.icon, 20) as SidIcon;
    const source = Number(s?.source);
    const step: SidStep = {
      icon: ICON_SET.has(icon) ? icon : "doc",
      label: str(s?.label, 60),
      title: str(s?.title, 80),
      body: str(s?.body, 400),
      pills: [pill(pills[0]), pill(pills[1])],
      next: str(s?.next, 40).replace(/\s*→\s*$/, ""),
      source: Number.isInteger(source) && source >= 0 && source < sources.length ? source : -1,
      facts: Array.isArray(s?.facts) ? s.facts.map((f: unknown) => str(f, 12)).filter(Boolean).slice(0, 12) : undefined,
    };
    if (!step.title || !step.body) throw new Error(`Шаг ${i + 1}: нет заголовка или текста`);
    if (step.source < 0) throw new Error(`Шаг ${i + 1}: не указан источник`);
    if (!step.pills[0][0] || !step.pills[0][1] || !step.pills[1][0] || !step.pills[1][1]) throw new Error(`Шаг ${i + 1}: плашки неполные`);
    return step;
  });
  const cover = r?.cover ?? {};
  const final = r?.final ?? {};
  const cards = (Array.isArray(final.cards) ? final.cards : []).slice(0, 3).map((c: any) => [str(c?.[0] ?? c?.badge, 10), str(c?.[1] ?? c?.title, 30), str(c?.[2] ?? c?.sub, 40)] as [string, string, string]);
  const content: SidContent = {
    topic: str(r?.topic, 200),
    topicKey: str(r?.topicKey, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""),
    cover: {
      pill: str(cover.pill, 20).toUpperCase() || "СРОЧНО",
      title: lines(cover.title, 3).map((x) => x.toUpperCase()),
      accentLine: str(cover.accentLine, 60).toUpperCase(),
      hook: str(cover.hook, 80) || "Что известно и что скрывают →",
      scene: str(cover.scene, 1500),
    },
    steps,
    final: { black: lines(final.black, 3).map((x) => x.toUpperCase()), accent: lines(final.accent, 3).map((x) => x.toUpperCase()), cards, body: str(final.body, 300) },
    caption: typeof r?.caption === "string" ? r.caption.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500) : "",
    sources,
  };
  if (!content.topic) throw new Error("Нет темы");
  if (!content.cover.title.length || !content.cover.accentLine) throw new Error("Обложка без заголовка");
  if (content.final.cards.length !== 3 || content.final.cards.some((c) => !c[0] || !c[1])) throw new Error("В финале нужны три карточки");
  if (!content.final.black.length || !content.final.accent.length || !content.final.body) throw new Error("Финал неполный");
  if (!content.caption) throw new Error("Нет подписи");
  return content;
}

/**
 * Что длиннее, чем помещается в вёрстку. Пределы — по одобренным каруселям 1–4; окончательно
 * проверяет сборка слайдов (measure), а этот список уходит Claude, чтобы он сократил сам.
 */
export const SID_LIMITS = {
  // обложка громкая (владелец 30.10, «ВЗЛОМАЛИ / BINANCE.»): 2–3 строки по 1–2 слова на всю ширину и строка с главной цифрой
  coverLine: 12,
  coverAccent: 22,
  label: 36,
  title: 32,
  body: 165,
  pillLabel: 11,
  pillValue: 13,
  next: 20,
  finalLine: 16,
  cardBadge: 4,
  cardTitle: 11,
  cardSub: 16,
  finalBody: 110,
  caption: 600,
} as const;

export function contentProblems(c: SidContent): string[] {
  const p: string[] = [];
  const over = (path: string, text: string, max: number) => {
    if (visible(text) > max) p.push(`${path}: ${visible(text)} знаков при пределе ${max} — «${text}»`);
  };
  c.cover.title.forEach((t, i) => over(`cover.title[${i}]`, t, SID_LIMITS.coverLine));
  over("cover.accentLine", c.cover.accentLine, SID_LIMITS.coverAccent);
  c.steps.forEach((s, i) => {
    over(`steps[${i}].label`, s.label, SID_LIMITS.label);
    over(`steps[${i}].title`, s.title, SID_LIMITS.title);
    over(`steps[${i}].body`, s.body, SID_LIMITS.body);
    s.pills.forEach(([k, v], j) => {
      over(`steps[${i}].pills[${j}][0]`, k, SID_LIMITS.pillLabel);
      over(`steps[${i}].pills[${j}][1]`, v, SID_LIMITS.pillValue);
    });
    over(`steps[${i}].next`, s.next, SID_LIMITS.next);
  });
  [...c.final.black, ...c.final.accent].forEach((t, i) => over(`final line ${i + 1}`, t, SID_LIMITS.finalLine));
  c.final.cards.forEach(([b, t, sub], i) => {
    over(`final.cards[${i}][0]`, b, SID_LIMITS.cardBadge);
    over(`final.cards[${i}][1]`, t, SID_LIMITS.cardTitle);
    over(`final.cards[${i}][2]`, sub, SID_LIMITS.cardSub);
  });
  over("final.body", c.final.body, SID_LIMITS.finalBody);
  if ([...c.caption].length > SID_LIMITS.caption) p.push(`caption: ${[...c.caption].length} знаков при пределе ${SID_LIMITS.caption}`);
  if (/#/.test(c.caption)) p.push("caption: без хэштегов");
  if (/\p{Extended_Pictographic}/u.test(c.caption)) p.push("caption: без эмодзи");
  if (/телеграм|telegram|в директ|в личк/i.test(c.caption + c.final.body)) p.push("caption/final.body: без Telegram и обещаний прислать что-то в личку");
  if (!/\?/.test(c.caption)) p.push("caption: нужен вопрос в конце");
  c.steps.forEach((s, i) => s.pills.forEach(([k, v], j) => {
    const why = pillProblem(v);
    if (why) p.push(`steps[${i}].pills[${j}]: значение плашки ${why} — «${k} ${v}»; поставь другую плашку с цифрой, датой, именем или статусом из фактов этого шага`);
  }));
  // карточка финала — главная цифра истории: «? · сумма · не раскрыта» — то же «неизвестно» в роли значения
  c.final.cards.forEach(([badge, t, sub], i) => {
    const why = pillProblem(t) ?? (badge.trim() === "?" ? "со знаком вопроса" : null) ?? (pillProblem(sub) === "не значение" ? "с подписью «неизвестно»" : null);
    if (why) p.push(`final.cards[${i}]: крупное значение карточки ${why} — «${[badge, t, sub].join(" · ")}»; поставь другую главную цифру истории`);
  });
  p.push(...punctuationProblems(c));
  return p;
}

/** Все текстовые поля карусели с путями — для проверок по всему тексту. */
function textFields(c: SidContent): [string, string][] {
  return [
    ...c.cover.title.map((t, i): [string, string] => [`cover.title[${i}]`, t]),
    ["cover.accentLine", c.cover.accentLine],
    ["cover.hook", c.cover.hook],
    ...c.steps.flatMap((s, i): [string, string][] => [
      [`steps[${i}].label`, s.label],
      [`steps[${i}].title`, s.title],
      [`steps[${i}].body`, s.body],
      ...s.pills.flatMap(([k, v], j): [string, string][] => [[`steps[${i}].pills[${j}][0]`, k], [`steps[${i}].pills[${j}][1]`, v]]),
      [`steps[${i}].next`, s.next],
    ]),
    ...[...c.final.black, ...c.final.accent].map((t, i): [string, string] => [`final line ${i + 1}`, t]),
    ...c.final.cards.flatMap((card, i) => card.map((t, j): [string, string] => [`final.cards[${i}][${j}]`, t])),
    ["final.body", c.final.body],
    ["caption", c.caption],
  ];
}

/**
 * Пунктуация аккаунта (владелец 30.10: «почему 2 тире, так ещё и одна длинная»): пояснение — после двоеточия
 * или новой фразой, длинного тире в текстах нет; слова целиком: «бывший», а не «экс-».
 */
export function punctuationProblems(c: SidContent): string[] {
  const p: string[] = [];
  for (const [path, text] of textFields(c)) {
    if (/—|\s–\s/.test(text)) p.push(`${path}: длинное тире; перепиши через двоеточие, точку или другими словами, как «Истец: бывший инженер Circle.»: «${text}»`);
    if (/(^|[^\p{L}])экс-/iu.test(text)) p.push(`${path}: вместо «экс-» пиши «бывший»: «${text}»`);
  }
  return p;
}

/**
 * Плашка показывает факт: цифру, дату, имя или статус («на паузе», «Draft», «не доказан»). Пустое место,
 * знак вопроса или «неизвестно» в роли значения — не факт: такую плашку меняют на другую из фактов шага.
 */
export function pillProblem(v: string): string | null {
  const t = v.replace(/\*\*/g, "").trim().toLowerCase().replace(/ё/g, "е");
  if (!t) return "пустое";
  if (!/[\p{L}\p{N}]/u.test(t)) return "без значения";
  if (/^(неизвестн|не известн|неясн|не ясн|не раскрыт|нет данных|не установлен|не уточн|unknown|tbd|n\/a|\?)/.test(t)) return "не значение";
  return null;
}

/** Правила, которые сборка слайдов проверяет вместе с вёрсткой: подпись, настоящие значения плашек и карточек, пунктуация. */
export const ruleProblems = (c: SidContent) => contentProblems(c).filter((p) => p.startsWith("caption") || /^steps\[\d\]\.pills\[\d\]: значение плашки|^final\.cards\[\d\]: крупное значение|: длинное тире;|: вместо «экс-»/.test(p));

// ===== Неподтверждённое и повторы окон =====

const plain = (s: string) => s.replace(/\*\*/g, "").replace(new RegExp(NBSP, "g"), " ").replace(/[«»"“”]/g, "").replace(/\s+/g, " ").trim().toLowerCase().replace(/ё/g, "е");

/** Весь видимый текст карусели: обложка, шаги с плашками, финал с карточками, подпись. */
export function visibleText(c: SidContent): string {
  return [
    ...c.cover.title, c.cover.accentLine, c.cover.hook,
    ...c.steps.flatMap((s) => [s.label, s.title, s.body, ...s.pills.flat(), s.next]),
    ...c.final.black, ...c.final.accent, ...c.final.cards.flat(), c.final.body,
    c.caption,
  ].map(plain).join("\n");
}

/** Куски текста, которые проверка фактов назвала неподтверждёнными, но они всё ещё стоят в карусели. */
export function leftoverFragments(c: SidContent, fragments: string[]): string[] {
  const text = visibleText(c);
  return [...new Set(fragments.map((f) => f.trim()).filter((f) => plain(f).length >= 3))].filter((f) => text.includes(plain(f)));
}

const urlKey = (u: string) => {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
};

/**
 * У каждого шага своё окно: если шаг взял ту же страницу, что предыдущий, ему подбирается другая из
 * исследования — сначала из фактов самого шага и другого издания, потом любая неиспользованная.
 * Нечего подставить — ошибка: одинаковых окон в карусели не бывает.
 */
export function dedupeSteps(c: SidContent, r: Pick<SidResearch, "facts" | "pages">): { content: SidContent; changes: string[] } {
  const content: SidContent = JSON.parse(JSON.stringify(c));
  const changes: string[] = [];
  const firstStep = new Map<string, number>();
  const repeats: { i: number; of: number }[] = [];
  content.steps.forEach((s, i) => {
    const key = urlKey(content.sources[s.source]?.url ?? "");
    if (firstStep.has(key)) repeats.push({ i, of: firstStep.get(key)! });
    else firstStep.set(key, i);
  });
  if (!repeats.length) return { content, changes };
  const used = new Set(firstStep.keys());
  const hostOfKey = (k: string) => k.split("/")[0];
  const pool = [
    ...r.facts.map((f) => ({ url: f.url, title: f.claim, publisher: f.publisher, date: f.date, fact: f.id })),
    ...r.pages.map((p) => ({ url: p.url, title: p.headline, publisher: p.publisher, date: undefined as string | undefined, fact: "" })),
  ].filter((x) => isHttpUrl(x.url));
  const free = () => pool.filter((x) => !used.has(urlKey(x.url)));
  const ownFree = (i: number) => free().filter((x) => x.fact && (content.steps[i].facts ?? []).includes(x.fact));
  // сначала шаги, у которых есть своя свободная страница: её не должен занять соседний шаг
  repeats.sort((a, b) => (ownFree(a.i).length ? 0 : 1) - (ownFree(b.i).length ? 0 : 1) || a.i - b.i);
  for (const { i, of } of repeats) {
    const usedHosts = new Set([...used].map(hostOfKey));
    const own = new Set(content.steps[i].facts ?? []);
    const rank = (x: (typeof pool)[number]) => (x.fact && own.has(x.fact) ? 0 : 2) + (usedHosts.has(hostOfKey(urlKey(x.url))) ? 1 : 0);
    const pick = free().sort((a, b) => rank(a) - rank(b))[0];
    if (!pick) throw new Error(`Шаг ${i + 1}: та же страница, что у шага ${of + 1}, а другой в исследовании нет`);
    let at = content.sources.findIndex((x) => urlKey(x.url) === urlKey(pick.url));
    if (at < 0) {
      content.sources.push({ url: pick.url, title: pick.title.slice(0, 300), publisher: pick.publisher || hostOf(pick.url), date: pick.date });
      at = content.sources.length - 1;
    }
    content.steps[i].source = at;
    used.add(urlKey(pick.url));
    changes.push(`шаг ${i + 1}: окно со страницы шага ${of + 1} заменено на ${hostOf(pick.url)}`);
  }
  return { content, changes };
}

// ===== Набор текста для вёрстки =====

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Короткие слова и предлоги не висят в конце строки, тире не начинает строку, число не отрывается от единицы.
 * В заголовке «млн» не склеивается со следующим словом: иначе цепочка «$60 млн за 15 месяцев» становится
 * одним неразрывным куском, и строка переносится как «Почти / $60 млн за 15 месяцев?».
 */
export function glue(s: string, title = false): string {
  const t = s
    .replace(/(^|[\s(«]|\*\*)([а-яёА-ЯЁ]{1,2}) /g, `$1$2${NBSP}`)
    .replace(/ ([—–]) /g, `${NBSP}$1 `)
    .replace(/(\d) (?=[\dа-яёА-ЯЁa-zA-Z$%])/g, `$1${NBSP}`);
  return title ? t : t.replace(/(млн|млрд|тыс\.) /g, `$1${NBSP}`);
}

/**
 * Слово с дефисом («Нью-Йорка», «SEED-фразы») переносится только целиком: браузер иначе рвёт его по дефису,
 * и в строке выходит «экс- / инженер». Применять к уже экранированному тексту, до вставки своих тегов.
 */
export const keepHyphens = (html: string) => html.replace(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+/gu, (w) => `<span style="white-space:nowrap">${w}</span>`);

/** Строка без разметки: экранирование, склейка и слова с дефисом без переноса. */
export const tx = (s: string, title = false) => keepHyphens(esc(glue(s, title)));

/** Текст шага: экранирование, склейка, слова с дефисом без переноса и **жирное**. */
export const rich = (s: string, title = false) => tx(s, title).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

/** Адрес для строки окна — как в одобренных каруселях: домен; у GitHub — ещё владелец и репозиторий. */
export function windowUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "github.com") return [host, ...u.pathname.split("/").filter(Boolean).slice(0, 2)].join("/");
    return host;
  } catch {
    return url.slice(0, 40);
  }
}
