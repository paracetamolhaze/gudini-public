import { isPaintedStory, PAINTED_STORY_RULES, storyDesignContext, type StoryDesign } from "./storyDirection";
import { researchDate } from "./research";
import { isMemeDesign, memeCategoryLine, memeLine, MEME_NICHE, MEME_RULES, memeSlideProblems, type MemeJoke, type MemeTrends } from "./meme";
import type { Carousel, CarouselRequest, Slide, SlideKind, TextPlacement, VisualConcept } from "./types";
import { CAROUSEL_LIMITS, DECK_LIMITS, DECK_TEXT, FORMATS, LANGUAGES, TEXT_LIMITS } from "./limits";
import { deckCaptionProblems, deckKindAt, deckSlideProblems, type DeckContext } from "./deck";
import { channelTitle, TELEGRAM_CHANNEL, type TelegramChannel } from "./channel";
export type { DeckContext } from "./deck";
import { getStyle } from "./styles";
import { captionProblems, cleanCaption, cleanCarouselCaption, cleanText, normalizeHashtags, splitTrailingHashtags, stripEmphasis, tooSimilar, visibleLength } from "./text";

/**
 * Промпты и разбор ответов GPT для каруселей. Модель возвращает только данные — JSON
 * с текстами полей и описаниями иллюстраций; разметку, оформление и проверки задаёт код.
 * Здесь чистые функции: они проверяются тестами без сети и без денег.
 */

export type DraftImage = { brief: string; composition: string; textPlacement: TextPlacement };
export type DraftSlide = { id?: string; kind: SlideKind; kicker: string; title: string; body: string; bullets: string[]; cta: string; image?: DraftImage };

export type Draft = {
  title: string;
  story: string[];
  slides: DraftSlide[];
  caption: string;
  hashtags: string[];
  claimsToCheck: string[];
  summary: string;
  visual?: VisualConcept;
};

/** problems — можно исправить повторным запросом; fatal — ответ негоден без исправления. */
export type Parsed = { draft: Draft; problems: string[]; fatal: string[] };

export const KIND_LABEL: Record<SlideKind, string> = { cover: "обложка", stake: "ставка", content: "содержательная", recap: "итог", final: "заключительная" };

/** Что делает карточка в карусели по скиллу — для переписывания одной карточки. */
const DECK_ROLE: Record<SlideKind, string> = {
  cover: `зацепка до ${DECK_TEXT.coverWords} слов в title и одна строка обещания в body`,
  stake: "одно предложение в title: почему это важно читателю; карточка работает как вторая обложка",
  content: `одна мысль: заголовок ${DECK_TEXT.ideaTitleWords.join("–")} слов в title и до ${DECK_TEXT.ideaWords} слов в body`,
  recap: `вся карусель списком в bullets (${DECK_TEXT.recapBullets.join("–")} пунктов), каждый пункт понятен без остальных карточек`,
  final: `одна короткая строка до ${DECK_TEXT.finalTitleWords} слов в title — про Telegram-канал автора; QR-код канала сайт ставит сам`,
};

export function todayLine(now = new Date()): string {
  return `Сегодня ${researchDate(now)}.`;
}

/**
 * Автор карусели по скиллу ig-carousel и подписи по «Job B» из ig-caption. Обучение с образцом:
 * как устроена хорошая карусель и как звучит хороший текст — без списков запретов.
 */
export function writerRules(channel: TelegramChannel | null): string {
  const tg = channel ? `Telegram-канал «${channelTitle(channel)}»${channel.about ? ` (${channel.about})` : ""}` : "Telegram-канал автора";
  return `Ты пишешь экспертные карусели для Instagram-аккаунта автора. Карусель листают пальцем на телефоне, и каждый свайп — решение читателя: каждая карточка зарабатывает следующую. Сайт сам сверстает карточки крупным шрифтом в цветах аккаунта, поставит номер «3/8», ник и аватарку аккаунта. От тебя — тексты карточек и подпись к посту.

Как устроена карусель, по порядку:
1. cover — обложка, от неё зависит почти весь результат. В title зацепка до ${DECK_TEXT.coverWords} слов: конкретная и понятная даже в сетке профиля размером с марку. В body одна строка обещания — что читатель получит, если пролистает.
2. stake — ставка. В title одно предложение: почему это важно читателю прямо сейчас. Instagram иногда показывает карусель повторно, начиная со второй карточки, поэтому ставка работает как вторая обложка — понятна без первой и цепляет сама.
3. content — по одной мысли на карточку. В title мысль из ${DECK_TEXT.ideaTitleWords.join("–")} слов, в body до ${DECK_TEXT.ideaWords} слов: механизм, пример, цифра из справки. Если мысли тесно, это две карточки. Для шагов или пунктов подойдёт короткий список bullets из 2–${DECK_TEXT.ideaBullets} пунктов вместо body.
4. recap — итог. Вся карусель одним списком в bullets: ${DECK_TEXT.recapBullets.join("–")} пунктов по 3–${DECK_TEXT.recapBulletWords} слов, каждый — одна короткая строка; title из 1–${DECK_TEXT.recapTitleWords} слов. Эту карточку сохраняют и пересылают другу, поэтому каждый пункт понятен без остальных карточек.
5. final — переход в ${tg}. Канал закрытый, вход по приглашению: сайт ставит на эту карточку крупный QR-код. От тебя — одна короткая строка в title, до ${DECK_TEXT.finalTitleWords} слов: зачем заходить в канал. body и cta пустые.
Карточки до финала целиком о теме: Telegram появляется один раз — на финале.

Как звучит хороший текст: так объясняет друг, который сам разобрался. Короткие фразы, конкретные слова, глаголы. «Комиссия съедает 3% с каждой сделки» вместо «комиссионные издержки оказывают существенное влияние на доходность». Карточка читается за 3–5 секунд. Одно-три ключевых слова в title можно выделить **так** — сайт покрасит их акцентным цветом; на обложке выделение обязательно. Цифры, даты и новости бери из приложенной справки — она твоя проверка точности; где цифры в справке нет, объясни механизм словами. Всё, что автору стоит перепроверить перед публикацией, перечисли в claimsToCheck. Пожелания автора в идее — тон, аудитория, что упомянуть — учитывай.

Образец карусели из 8 карточек на тему «Как проверить токен перед покупкой»:
1 cover — title «Проверь токен **за 5 минут**», body «Четыре проверки, которых не видно на графике»
2 stake — title «Пять минут проверки дешевле, чем токен, который нельзя продать»
3 content — title «Кто держит монеты», body «Открой список держателей в обозревателе блоков. Если у пяти кошельков больше половины монет, цену решают они, а не рынок.»
4 content — title «Можно ли его продать», body «Сервисы проверки контракта показывают запрет на продажу и скрытую комиссию. Увидел такое — проходи мимо.»
5 content — title «Заперта ли ликвидность», body «Если создатель может забрать пул в любой момент, монеты превратятся в фантики за одну транзакцию.»
6 content — title «Кто говорит о проекте», body «Посмотри, кто обсуждает токен. Сотни одинаковых сообщений — это боты, а не спрос.»
7 recap — title «Чек-лист перед покупкой», bullets «Нет кошелька с половиной монет», «Контракт разрешает продажу», «Ликвидность заперта», «Обсуждают живые люди»
8 final — title «Новые токены разбираю в Telegram»

Подпись к посту (caption) — тоже содержание: обложка уже потратила свои шесть слов, и подпись работает сама.
- Первая строка — зацепка до ${DECK_TEXT.captionHookChars} знаков: Instagram показывает только её, остальное прячет за «ещё». Она конкретная, начинается сразу с сути и обрывается на интриге, а не на середине мысли.
- Дальше 2–4 короткие строки через пустую строку: что читатель узнает и почему это работает. В них обычными фразами входят слова, которые человек набрал бы в поиске Instagram по теме, например «как проверить токен».
- Последняя строка — одно действие: зайти в ${tg} по QR-коду на последнем слайде. Канал закрытый, поэтому ни ник с @, ни ссылка не нужны: QR — единственный вход.
- Хэштеги — отдельно в hashtags: ${DECK_TEXT.hashtags.join("–")} точных ярлыка темы вроде #мемкоины или #трейдинг. Общие теги ничего не описывают и не дают охвата.
- Эмодзи — не больше одного, как знак препинания. Вместо длинного тире в подписи обычный дефис "-".
Образец подписи к той же карусели:
«Пять минут проверки дешевле, чем токен, который нельзя продать.

Смотрим держателей, контракт, ликвидность и живое обсуждение.

Всё это видно бесплатно, ещё до покупки.

Разборы новых токенов каждый день - в моём Telegram-канале, QR на последнем слайде.»
hashtags: ["#мемкоины", "#криптовалюта", "#токены"]`;
}

export const WRITER_RULES = writerRules(null);

/** Прежние карусели с текстом поверх иллюстрации: обложка, содержательные, заключительная. */
export const OVERLAY_WRITER_RULES = `Ты — редактор экспертных каруселей для Instagram. Пишешь тексты карточек, которые затем программно вёрстаются крупным шрифтом, и подпись к посту.

Как писать:
- Только в подписи поста (caption) используй обычный дефис ASCII "-" вместо длинных и средних тире. Это правило не относится к текстам самих карточек.
- Одна карточка — одна мысль. Карточки не повторяют друг друга ни словами, ни смыслом; каждая добавляет новое.
- Обложка цепляет: конкретная польза, интрига или сильное утверждение по теме. Без обмана и пустого кликбейта.
- Содержательные карточки выстроены как история: от проблемы или вопроса через разбор к решениям и выводу.
- Заключительная карточка подводит итог и даёт простой призыв без давления: сохранить, написать в комментариях, поделиться.
- Факты не выдумываются. Никаких придуманных исследований, статистики, процентов, цитат, имён, дат, цен и ссылок на источники. Если без точной цифры не обойтись, а уверенности нет — формулируй без цифры. Всё, что автору стоит проверить перед публикацией, перечисли в claimsToCheck (пустой массив, если проверять нечего).
- Не обещай медицинских, финансовых и юридических результатов.
- Коротко: карточку читают за 3–5 секунд. Текст карточки — 1–3 коротких предложения или короткий список. Простые слова, активный залог, без канцелярита и воды.
- На карточках нет эмодзи, хэштегов, ссылок и нумерации вида «1/7» — номер ставит вёрстка.
- В заголовке можно выделить 1–3 ключевых слова двойными звёздочками: **так**. Не больше одного выделения на заголовок; в других полях звёздочки не используются.
- Идея автора может содержать пожелания: тон, аудиторию, что упомянуть или чего избегать. Учитывай их.

Пределы длины в символах с пробелами — не превышай:
- cover: kicker ≤ ${TEXT_LIMITS.cover.kicker} (метка над заголовком, можно пусто), title ≤ ${TEXT_LIMITS.cover.title}, body ≤ ${TEXT_LIMITS.cover.body} (подзаголовок, можно пусто).
- content: kicker ≤ ${TEXT_LIMITS.content.kicker} (например «Ошибка 2» или «Шаг 3», можно пусто), title ≤ ${TEXT_LIMITS.content.title}, и одно из двух: body ≤ ${TEXT_LIMITS.content.body} без списка, либо bullets из 2–${TEXT_LIMITS.content.bullets} пунктов ≤ ${TEXT_LIMITS.content.bullet} каждый и body ≤ ${TEXT_LIMITS.content.bodyWithBullets} или пусто.
- final: kicker ≤ ${TEXT_LIMITS.final.kicker}, title ≤ ${TEXT_LIMITS.final.title}, body ≤ ${TEXT_LIMITS.final.body}, cta ≤ ${TEXT_LIMITS.final.cta}.

В caption не добавляй «Сохрани карусель», призывы сохранять или подписываться, подпись автора и TG-ссылку: подпись на карточках не переносится в текст поста.
Подпись caption: 400–1500 символов, живой текст, раскрывает тему глубже карточек и не повторяет их дословно; первая строка — крючок; в конце вопрос к читателю. Эмодзи в подписи умеренно или без них. Хэштегов в подписи нет: 5–12 штук отдельно в hashtags, по теме.`;

export const ILLUSTRATION_RULES = `Иллюстрации. Каждую карточку сопровождает сгенерированная картинка, а текст сайт накладывает поверх сам. Ты — постановщик задач для генератора изображений.
- visual — общая визуальная концепция серии, по-английски (генератор понимает её точнее): idea (что объединяет все картинки серии), style (художественный стиль и техника, например «soft 3D clay render» или «flat vector editorial illustration»), palette (3–5 цветов), lighting (освещение и настроение), characters (повторяющиеся персонажи: name и look — подробное описание внешности, возраста, причёски, одежды, чтобы генератор рисовал их одинаково на всех карточках; если персонажи не нужны — пустой массив), objects (повторяющиеся предметы, до 6).
- У каждой карточки image: brief — 1–3 предложения по-английски о том, что изображено именно на этой карточке и как сцена раскрывает её мысль. Не пересказ темы всей карусели: у каждой карточки своя сцена, своё действие, свои детали. composition — кадр, ракурс, где главный объект, что на переднем и заднем плане. textPlacement — "bottom" или "top": где на карточке будет текст; там картинка должна быть спокойной. У обложки обычно "bottom".
- Сцены разнообразны: композиции, ракурсы и предметы не повторяются от карточки к карточке без смысла, но стиль, палитра, свет и персонажи одни на всю серию.
- Картинки не содержат никакого текста, надписей, цифр, логотипов и интерфейсов — этого в brief не просить.
- Никаких реальных людей, узнаваемых брендов и чужих персонажей.`;

const generationFormat = (illustrated: boolean) =>
  illustrated
    ? `Ответ — строго один JSON-объект без markdown и пояснений:
{"title":"рабочее название до 90 символов","story":["роль карточки 1","..."],"visual":{"idea":"","style":"","palette":"","lighting":"","characters":[{"name":"","look":""}],"objects":[]},"slides":[{"kind":"cover","kicker":"","title":"","body":"","image":{"brief":"","composition":"","textPlacement":"bottom"}},{"kind":"content","kicker":"","title":"","body":"","bullets":[],"image":{"brief":"","composition":"","textPlacement":"bottom"}},{"kind":"final","kicker":"","title":"","body":"","cta":"","image":{"brief":"","composition":"","textPlacement":"bottom"}}],"caption":"","hashtags":["#пример"],"claimsToCheck":[]}
story — план истории: по одной короткой строке на каждую карточку в том же порядке.`
    : `Ответ — строго один JSON-объект без markdown и пояснений:
{"title":"рабочее название до 90 символов","story":["роль карточки 1","..."],"slides":[{"kind":"cover","kicker":"","title":"","body":""},{"kind":"content","kicker":"","title":"","body":"","bullets":[]},{"kind":"final","kicker":"","title":"","body":"","cta":""}],"caption":"","hashtags":["#пример"],"claimsToCheck":[]}
story — план истории: по одной короткой строке на каждую карточку в том же порядке.`;

const DECK_FORMAT = `Ответ — строго один JSON-объект без markdown и пояснений:
{"title":"рабочее название до 90 символов","story":["роль карточки 1","..."],"slides":[{"kind":"cover","title":"","body":""},{"kind":"stake","title":""},{"kind":"content","title":"","body":"","bullets":[]},{"kind":"recap","title":"","bullets":[]},{"kind":"final","title":""}],"caption":"","hashtags":["#пример"],"claimsToCheck":[]}
content повторяется столько раз, сколько карточек-мыслей в задании. story — план истории: по одной короткой строке на каждую карточку в том же порядке.`;

/** deck — карусель по скиллу ig-carousel; у неё нет иллюстраций, рисованного режима и мемов. */
export function generationSystem(illustrated = false, design?: StoryDesign, deck = false): string {
  if (deck) return [writerRules(TELEGRAM_CHANNEL), DECK_FORMAT].join("\n\n");
  if (illustrated && isMemeDesign(design)) return [MEME_RULES, generationFormat(true)].join("\n\n");
  if (illustrated && isPaintedStory(design)) return [PAINTED_STORY_RULES, storyDesignContext(design), generationFormat(true)].join("\n\n");
  return [OVERLAY_WRITER_RULES, illustrated ? ILLUSTRATION_RULES : "", generationFormat(illustrated)].filter(Boolean).join("\n\n");
}

export type GenerationOpts = { illustrated?: boolean; deck?: boolean; illustrationStyle?: string; design?: StoryDesign; now?: Date; usedJokes?: string[]; chosenJokes?: MemeJoke[] };

/** Общее для всех шагов мем-карусели: дата, ниша аккаунта, тема и язык. */
function memeContext(req: CarouselRequest, now?: Date): string[] {
  const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "long", timeZone: "Asia/Qyzylorda" }).format(now ?? new Date());
  return [
    todayLine(now),
    `День недели: ${weekday}.`,
    MEME_NICHE,
    memeCategoryLine(req.memeCategory),
    `Тема мемов: «${req.idea}»`,
    req.wishes ? `Пожелания автора: «${req.wishes}»` : "",
    `Язык всех текстов: ${LANGUAGES[req.language].prompt}.`,
  ];
}

const usedLine = (used?: string[]) => (used?.length ? `Эти шутки уже выходили в прошлых подборках — возьми другие ситуации и другие развязки:\n${used.map((j) => `- ${j}`).join("\n")}` : "");
const jokeLine = (j: MemeJoke) => `${j.format ? `[${j.format}] ` : ""}${j.texts.join(" / ")}${j.scene ? ` — сцена: ${j.scene}` : ""}`;

/** Сколько кандидатов придумывать на одну карусель: выбор из вчетверо большего числа — автор одобряет примерно одну шутку из пяти. */
export const memeCandidateCount = (slides: number) => Math.min(32, slides * 4);

export type MemeTaste = { liked: string[]; disliked: string[] };

/** Оценки автора 👍/👎: живой образец его юмора поверх постоянной планки. */
const tasteLines = (taste?: MemeTaste) => [
  taste?.liked.length ? `Исторические отметки 👍: автор выбрал эти конкретные исполнения из предложенного. Это не запрос на постоянные убытки, унижение героя или тот же финал. Извлекай приём, настроение и развязку придумывай заново с учётом свежей поправки автора:\n${taste.liked.map((j) => `- ${j}`).join("\n")}` : "",
  taste?.disliked.length ? `Автор отметил 👎 у этих конкретных мемов. Причина неизвестна; сравни исполнение с удачными примерами и предложи более сильную сцену и развязку. Темы и персонажи остаются доступны:\n${taste.disliked.map((j) => `- ${j}`).join("\n")}` : "",
];

/** Находки мемолога: уже залетевшие мемы — их приём сценарист переносит в категорию. */
const trendLines = (t?: MemeTrends) => [
  t?.memes.length
    ? `Находки мемолога — необязательные источники приёмов. Используй только совместимые со свежими пожеланиями автора; популярность чужой шутки не доказывает качество её адаптации. Не переноси автоматически отрицательный исход:\n${t.memes.map((m) => `- ${m.original}${m.why ? ` — почему залетел: ${m.why}` : ""}${m.adaptation ? ` — как перенести: ${m.adaptation}` : ""}`).join("\n")}`
    : "",
];

export function memeIdeasUser(req: CarouselRequest, o: { now?: Date; usedJokes?: string[]; count?: number; taste?: MemeTaste; trends?: MemeTrends } = {}): string {
  return [...memeContext(req, o.now), `Кандидатов: ровно ${o.count ?? memeCandidateCount(req.slideCount)}.`, ...trendLines(o.trends), ...tasteLines(o.taste), usedLine(o.usedJokes)].filter(Boolean).join("\n");
}

/** Новая шутка для одного слайда: выбор из десяти кандидатов. */
export const MEME_SINGLE_CANDIDATES = 10;

export function memePickUser(req: CarouselRequest, pool: MemeJoke[], now?: Date, taste?: MemeTaste, recent?: string[]): string {
  return [
    ...memeContext(req, now),
    ...tasteLines(taste),
    recent?.length ? `Недавние мемы этой серии — контекст повторов, а не положительные примеры. Сравни результат и устройство шутки: смена костюма не делает очередной убыток новым приёмом. После серии проигрышей ищи сильную шутку с другим исходом; слабый позитив тоже отклони. Если все кандидаты продолжают ту же заезженную развязку, не выбирай никого:\n${recent.slice(0, 8).map(j => `- ${j}`).join("\n")}` : "",
    `Выбери не больше ${req.slideCount}. Можно меньше или ни одного: если сильных мемов нет, верни {"picked":[]}. Количество не снижает планку.`,
    "Перед выбором сверь надписи в сцене со списком texts: художник рисует только перечисленные тексты. Если развязка зависит от кнопки «КУПИТЬ», надписи «СБ» на календаре, названия на конверте или другой фразы, а её нет в texts, отклони кандидата. Не считай, что художник сам добавит недостающие слова. В why назови видимую развязку и объясни, почему перечисленных текстов для неё достаточно.",
    "Кандидаты:",
    ...pool.map((j, i) => `${i + 1}) ${jokeLine(j)}`),
  ].filter(Boolean).join("\n");
}

export function generationUser(req: CarouselRequest, opts: GenerationOpts | Date = {}): string {
  const o: GenerationOpts = opts instanceof Date ? { now: opts } : opts;
  if (o.illustrated && isMemeDesign(o.design)) {
    return [
      ...memeContext(req, o.now),
      `Мемов: ровно ${req.slideCount}, каждый — отдельный слайд со своей ситуацией. Первый — самый сильный, он же обложка.`,
      `Формат карточки ${FORMATS[req.format].label}: генератор рисует мем целиком — сцену и пузыри с текстом.`,
      req.format === "square" ? "Квадратная карточка ниже вертикальной — завязки ещё короче." : "",
      o.chosenJokes?.length
        ? `Шутки этой карусели выбрал редактор — по одной на слайд, в этом порядке. Сохрани их смысл и формулировки, продумай постановку сцены, визуал и подпись:\n${o.chosenJokes.map((j, i) => `${i + 1}) ${jokeLine(j)}`).join("\n")}`
        : usedLine(o.usedJokes),
    ].filter(Boolean).join("\n");
  }
  if (o.deck) {
    const channel = TELEGRAM_CHANNEL;
    const ideas = req.slideCount - 4;
    return [
      todayLine(o.now),
      `Идея: «${req.idea}»`,
      req.wishes ? `Пожелания автора: «${req.wishes}»` : "",
      `Карточек: ровно ${req.slideCount} — обложка, ставка, ${ideas} ${ideas === 1 ? "карточка-мысль" : ideas < 5 ? "карточки-мысли" : "карточек-мыслей"}, итог и финал с переходом в Telegram.`,
      channel ? `Telegram-канал автора: «${channelTitle(channel)}» — ${channel.about}. Закрытый, вход по QR-коду на последнем слайде.` : "",
      `Язык всех текстов карточек и подписи: ${LANGUAGES[req.language].prompt}.`,
    ].filter(Boolean).join("\n");
  }
  const lines = [
    todayLine(o.now),
    `Идея: «${req.idea}»`,
    req.wishes ? `Пожелания автора: «${req.wishes}»` : "",
    `Карточек: ровно ${req.slideCount} — обложка, ${req.slideCount - 2} содержательных, заключительная.`,
    `Язык всех текстов карточек и подписи: ${LANGUAGES[req.language].prompt}.`,
  ];
  if (o.illustrated) {
    lines.push(`Формат карточки ${FORMATS[req.format].label}, ${isPaintedStory(o.design) ? "цельная рисованная карточка с надписями" : "иллюстрация на весь кадр, текст поверх"}.`);
    if (o.illustrationStyle) lines.push(`Предпочтительный стиль иллюстраций автора (учти в visual): «${o.illustrationStyle}».`);
  } else {
    const style = getStyle(req.style);
    lines.push(`Оформление: стиль «${style.label}» (${style.description}), формат ${FORMATS[req.format].label}.`);
  }
  if (req.format === "square") lines.push("Квадратная карточка ниже вертикальной — пиши ещё короче.");
  return lines.filter(Boolean).join("\n");
}

export function repairUser(previous: unknown, problems: string[]): string {
  return [
    "Проверка нашла замечания к твоему ответу. Исправь только то, что нарушено: сократи, убери повторы, добавь недостающее. Остальное оставь без изменений. Ответ — тот же JSON-формат целиком.",
    "",
    "Замечания:",
    ...problems.map((p) => `- ${p}`),
    "",
    "Твой ответ:",
    JSON.stringify(previous),
  ].join("\n");
}

const editFormat = (illustrated: boolean) => `Тебе дают готовую карусель в JSON (поле n — номер карточки, как её видит автор) и поручение автора. Выполни поручение точно и не меняй того, о чём не просили.
- Сохраняй id существующих карточек. У новой карточки id — пустая строка.
- Первая карточка — cover, последняя — final. Содержательные карточки можно переставлять, добавлять и удалять, только если поручение этого требует; всего от ${CAROUSEL_LIMITS.minSlides} до ${CAROUSEL_LIMITS.maxSlides} карточек.
- Подпись и хэштеги меняй, только если поручение их касается; иначе верни как были.${
  illustrated
    ? "\n- У каждой карточки есть image (описание иллюстрации). Возвращай его как было, если поручение не про картинку этой карточки; у новой карточки напиши image заново по правилам иллюстраций."
    : ""
}
- Если поручение невыполнимо без выдумывания фактов, не выдумывай: сделай ближайшее честное изменение и скажи об этом в summary.
Ответ — строго один JSON-объект без markdown:
{"story":["роль карточки 1","роль карточки 2"],"slides":[{"id":"","kind":"cover","kicker":"","title":"","body":"","bullets":[],"cta":""${illustrated ? ',"image":{"brief":"","composition":"","textPlacement":"bottom"}' : ""}}],"caption":"","hashtags":[],"claimsToCheck":[],"summary":"что изменено — одна фраза для автора"}
story — массив строк: по одному краткому описанию роли каждой карточки, в том же порядке. Не объекты.
summary пиши простыми словами для автора: «сократил текст второго слайда», а не названиями полей JSON (body, cta, kicker).`;

const DECK_EDIT_FORMAT = `Тебе дают готовую карусель в JSON (поле n — номер карточки, как её видит автор) и поручение автора. Выполни поручение точно, остальное оставь как было.
- Сохраняй id существующих карточек. У новой карточки id — пустая строка.
- Роли стоят по местам: первая карточка — cover, вторая — stake, предпоследняя — recap, последняя — final, между ними content. Карточки-мысли можно переставлять, добавлять и удалять, если этого требует поручение; всего от ${DECK_LIMITS.minSlides} до ${DECK_LIMITS.maxSlides} карточек. Изменились мысли — обнови и итог.
- Подпись и хэштеги меняй, когда поручение их касается; иначе верни как были.
- Если поручение требует фактов, которых нет в справке, сделай ближайшее честное изменение и скажи об этом в summary.
Ответ — строго один JSON-объект без markdown:
{"story":["роль карточки 1","роль карточки 2"],"slides":[{"id":"","kind":"cover","title":"","body":"","bullets":[],"cta":""}],"caption":"","hashtags":[],"claimsToCheck":[],"summary":"что изменено — одна фраза для автора"}
story — массив строк: по одному краткому описанию роли каждой карточки, в том же порядке.
summary пиши простыми словами для автора: «сократил текст второго слайда».`;

export function editSystem(illustrated = false, design?: StoryDesign, deck = false): string {
  if (deck) return [writerRules(TELEGRAM_CHANNEL), DECK_EDIT_FORMAT].join("\n\n");
  if (illustrated && isMemeDesign(design)) return [MEME_RULES, editFormat(true)].join("\n\n");
  if (illustrated && isPaintedStory(design)) return [PAINTED_STORY_RULES, storyDesignContext(design), editFormat(true)].join("\n\n");
  return [OVERLAY_WRITER_RULES, illustrated ? ILLUSTRATION_RULES : "", editFormat(illustrated)].filter(Boolean).join("\n\n");
}

export function carouselForPrompt(c: Pick<Carousel, "title" | "slides" | "caption" | "hashtags" | "claimsToCheck" | "mode" | "visual">): string {
  const illustrated = c.mode === "illustrated";
  return JSON.stringify(
    {
      title: c.title,
      ...(illustrated && c.visual ? { visual: c.visual } : {}),
      slides: c.slides.map((s, i) => ({
        n: i + 1,
        id: s.id,
        kind: s.kind,
        kicker: s.kicker,
        title: s.title,
        body: s.body,
        bullets: s.bullets,
        cta: s.cta,
        ...(illustrated ? { image: { brief: s.image?.brief ?? "", composition: s.image?.composition ?? "", textPlacement: s.image?.textPlacement ?? "bottom" } } : {}),
      })),
      caption: c.caption,
      hashtags: c.hashtags,
      claimsToCheck: c.claimsToCheck,
    },
    null,
    1,
  );
}

export function instructUser(c: Carousel, instruction: string, now = new Date()): string {
  return [todayLine(now), `Язык карусели: ${LANGUAGES[c.language].prompt}.`, `Поручение автора: «${instruction}»`, "", "Карусель:", carouselForPrompt(c)].join("\n");
}

const regenerateFormat = (illustrated: boolean) => `Тебе дают карусель и номер карточки, которую нужно написать заново: та же роль в истории, новая формулировка, без повторов с остальными карточками.${
  illustrated ? " Опиши и новую иллюстрацию (image) в общей визуальной концепции серии." : ""
}
Ответ — строго один JSON-объект без markdown:
{"slide":{"kind":"content","kicker":"","title":"","body":"","bullets":[],"cta":""${illustrated ? ',"image":{"brief":"","composition":"","textPlacement":"bottom"}' : ""}},"claimsToCheck":[]}`;

const DECK_REGENERATE_FORMAT = `Тебе дают карусель и номер карточки, которую нужно написать заново: та же роль в истории, новая формулировка, новое по смыслу относительно остальных карточек.
Ответ — строго один JSON-объект без markdown:
{"slide":{"kind":"content","title":"","body":"","bullets":[],"cta":""},"claimsToCheck":[]}`;

export function regenerateSystem(illustrated = false, design?: StoryDesign, deck = false): string {
  if (deck) return [writerRules(TELEGRAM_CHANNEL), DECK_REGENERATE_FORMAT].join("\n\n");
  if (illustrated && isMemeDesign(design)) return [MEME_RULES, regenerateFormat(true)].join("\n\n");
  if (illustrated && isPaintedStory(design)) return [PAINTED_STORY_RULES, storyDesignContext(design), regenerateFormat(true)].join("\n\n");
  return [OVERLAY_WRITER_RULES, illustrated ? ILLUSTRATION_RULES : "", regenerateFormat(illustrated)].filter(Boolean).join("\n\n");
}

export function regenerateUser(c: Carousel, index: number, hint: string, now = new Date(), chosen?: MemeJoke, deck = false): string {
  const s = c.slides[index];
  return [
    todayLine(now),
    `Язык карусели: ${LANGUAGES[c.language].prompt}.`,
    `Напиши заново карточку №${index + 1} (${KIND_LABEL[s.kind]}, kind="${s.kind}")${deck ? `: ${DECK_ROLE[s.kind]}` : ""}.`,
    `Пожелание автора: ${hint ? `«${hint}»` : "нет"}`,
    ...(chosen ? [`Новую шутку для этой карточки выбрал редактор — сохрани её смысл и формулировки, продумай постановку сцены: ${jokeLine(chosen)}`] : []),
    "",
    "Карусель:",
    carouselForPrompt(c),
  ].join("\n");
}

export function extractJson(raw: string): any {
  // Codex's outer result string can contain literal caption newlines in inner JSON.
  // Escape controls only inside quoted strings; never alter structure or content.
  let safe = "", quoted = false, escaped = false;
  for (const char of raw) {
    if (quoted && char.charCodeAt(0) < 32) {
      safe += JSON.stringify(char).slice(1, -1);
      escaped = false;
      continue;
    }
    safe += char;
    if (escaped) { escaped = false; continue; }
    if (quoted && char === "\\") { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
  }
  const cleaned = safe.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {}
    // модель написала прямые кавычки внутри текста («+ "блядь" в конце») — чиним и пробуем снова
    try {
      return JSON.parse(repairInnerQuotes(cleaned.slice(start, end + 1)));
    } catch {}
  }
  throw new Error("ответ GPT не разобрался как JSON");
}

/**
 * Прямая кавычка внутри строки, после которой не кончается значение (запятая, скобка,
 * двоеточие), — это текст, а не конец строки: экранируем её.
 */
export function repairInnerQuotes(json: string): string {
  let out = "";
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (quoted && ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch !== '"') {
      out += ch;
      continue;
    }
    if (!quoted) {
      quoted = true;
      out += ch;
      continue;
    }
    let j = i + 1;
    while (j < json.length && /\s/.test(json[j])) j++;
    const next = json[j];
    if (next === undefined || next === "," || next === "}" || next === "]" || next === ":") {
      quoted = false;
      out += ch;
    } else {
      out += '\\"';
    }
  }
  return out;
}

export function kindAt(index: number, total: number): SlideKind {
  return index === 0 ? "cover" : index === total - 1 ? "final" : "content";
}

const IMAGE_TEXT_MAX = 700;

/** Описание иллюстрации — только данные: текст обрезается, место текста приводится к top|bottom. */
export function normalizeImage(input: any): DraftImage | undefined {
  if (!input || typeof input !== "object") return undefined;
  const brief = cleanText(input.brief, { max: IMAGE_TEXT_MAX });
  return { brief, composition: cleanText(input.composition, { max: IMAGE_TEXT_MAX }), textPlacement: input.textPlacement === "top" ? "top" : "bottom" };
}

/** deck — карусель по скиллу: метки над заголовком нет, финал — одна строка, QR канала ставит код. */
export function normalizeSlide(input: any, kind: SlideKind, illustrated = false, meme = false, deck?: DeckContext): DraftSlide {
  // у мема в bullets третий текст разворота — на любом слайде, включая обложку и финал
  const listed = kind === "content" || kind === "recap" || meme;
  const bullets = listed && Array.isArray(input?.bullets) ? input.bullets.map((b: unknown) => cleanText(b)).filter(Boolean).slice(0, 6) : [];
  const deckFinal = Boolean(deck) && kind === "final";
  const slide: DraftSlide = {
    id: typeof input?.id === "string" && input.id ? input.id : undefined,
    kind,
    kicker: deck ? "" : cleanText(input?.kicker),
    title: cleanText(input?.title),
    body: deckFinal ? "" : cleanText(input?.body),
    bullets,
    cta: kind !== "final" || deckFinal ? "" : cleanText(input?.cta),
  };
  if (illustrated) slide.image = normalizeImage(input?.image) ?? { brief: "", composition: "", textPlacement: "bottom" };
  return slide;
}

export function normalizeVisual(input: any): VisualConcept | undefined {
  if (!input || typeof input !== "object") return undefined;
  const characters = Array.isArray(input.characters)
    ? input.characters
        .map((ch: any) => ({ name: cleanText(ch?.name, { max: 60 }), look: cleanText(ch?.look, { max: 400 }) }))
        .filter((ch: { name: string; look: string }) => ch.look)
        .slice(0, 4)
    : [];
  const objects = Array.isArray(input.objects) ? input.objects.map((o: unknown) => cleanText(o, { max: 120 })).filter(Boolean).slice(0, 6) : [];
  return {
    idea: cleanText(input.idea, { max: 400 }),
    style: cleanText(input.style, { max: 400 }),
    palette: cleanText(input.palette, { max: 200 }),
    lighting: cleanText(input.lighting, { max: 200 }),
    characters,
    objects,
  };
}

export function slideProblems(s: DraftSlide, n: number, illustrated = false, meme = false, deck = false): string[] {
  if (deck) return deckSlideProblems(s, n);
  const k = TEXT_LIMITS[s.kind];
  const p: string[] = [];
  if (meme) {
    p.push(...memeSlideProblems(s, n));
    if (!s.image?.brief || s.image.brief.length < 20) p.push(`карточка ${n}: нет описания иллюстрации image.brief (1–3 предложения по-английски)`);
    return p;
  }
  const over = (field: string, value: string, limit: number) => {
    const len = visibleLength(value);
    if (len > limit) p.push(`карточка ${n}: ${field} ${len} символов при пределе ${limit}`);
  };
  if (!s.title) p.push(`карточка ${n}: пустой заголовок`);
  over("kicker", s.kicker, k.kicker);
  over("title", s.title, k.title);
  over("body", s.body, s.bullets.length ? k.bodyWithBullets : k.body);
  if (s.kind === "content") {
    if (s.bullets.length > k.bullets) p.push(`карточка ${n}: пунктов списка ${s.bullets.length}, максимум ${k.bullets}`);
    if (s.bullets.length === 1) p.push(`карточка ${n}: список из одного пункта — перенесите его в body`);
    s.bullets.forEach((b, i) => over(`пункт ${i + 1}`, b, k.bullet));
    if (!s.body && !s.bullets.length) p.push(`карточка ${n}: нет содержания — нужен body или bullets`);
  }
  if (s.kind === "final") over("cta", s.cta, k.cta);
  if (/(^|\s)#[\p{L}\p{N}_]/u.test(`${s.kicker} ${s.title} ${s.body} ${s.bullets.join(" ")}`)) p.push(`карточка ${n}: хэштеги на карточке — перенесите в hashtags`);
  const extraStars = [s.kicker, s.body, ...s.bullets, s.cta].some((x) => x.includes("**"));
  if (extraStars) p.push(`карточка ${n}: звёздочки выделения допустимы только в заголовке`);
  if (illustrated) {
    if (!s.image?.brief || s.image.brief.length < 20) p.push(`карточка ${n}: нет описания иллюстрации image.brief (1–3 предложения по-английски)`);
    else if (/\b(text|caption|headline|title|words|letters|typography)\b.*\b(reads?|saying|says|written|spelled)\b/i.test(s.image.brief)) {
      p.push(`карточка ${n}: image.brief дублирует буквальный текст — оставьте его только в текстовых полях`);
    }
  }
  return p;
}

export function repetitionProblems(slides: DraftSlide[]): string[] {
  const p: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    for (let j = i + 1; j < slides.length; j++) {
      const a = slides[i];
      const b = slides[j];
      // ставка — вторая обложка той же темы: общие с зацепкой слова темы повтором не считаются
      if (a.kind === "cover" && b.kind === "stake") continue;
      if (tooSimilar(a.title, b.title)) p.push(`карточки ${i + 1} и ${j + 1}: заголовки повторяют друг друга`);
      else if (a.body.length > 40 && b.body.length > 40 && tooSimilar(a.body, b.body)) p.push(`карточки ${i + 1} и ${j + 1}: текст повторяется`);
      else if (a.image?.brief && b.image?.brief && a.image.brief.length > 40 && tooSimilar(a.image.brief, b.image.brief)) {
        p.push(`карточки ${i + 1} и ${j + 1}: описания иллюстраций почти одинаковые — у каждой карточки своя сцена`);
      }
    }
  }
  return p;
}

const uniq = (list: string[]) => [...new Set(list)];

function stringList(value: unknown, max: number, itemMax: number): string[] {
  return Array.isArray(value) ? value.filter((x) => typeof x === "string").map((x) => cleanText(x, { max: itemMax })).filter(Boolean).slice(0, max) : [];
}

/** deck — карусель по скиллу ig-carousel: свои роли, минимум 6 карточек, подпись по «Job B». */
export type NormalizeOpts = { expectedCount?: number; existing?: Slide[]; illustrated?: boolean; meme?: boolean; deck?: DeckContext };

/** Разбор ответа с каруселью целиком: генерация и правка по поручению. */
export function normalizeDraft(json: any, opts: NormalizeOpts = {}): Parsed {
  const illustrated = Boolean(opts.illustrated);
  const deck = opts.deck;
  const limits = deck ? DECK_LIMITS : CAROUSEL_LIMITS;
  const fatal: string[] = [];
  const problems: string[] = [];
  const rawSlides: any[] = Array.isArray(json?.slides) ? json.slides : [];
  if (json?.story !== undefined && (!Array.isArray(json.story) || json.story.some((x: unknown) => typeof x !== "string"))) problems.push("story должен быть массивом строк: по одному описанию роли каждой карточки, не объектов");
  if (rawSlides.length > limits.maxSlides) problems.push(`карточек ${rawSlides.length}, максимум ${limits.maxSlides}`);
  const list = rawSlides.slice(0, limits.maxSlides);
  if (opts.expectedCount && list.length !== opts.expectedCount) problems.push(`нужно ровно ${opts.expectedCount} карточек, получено ${list.length}`);
  if (list.length < limits.minSlides) fatal.push(`карточек ${list.length}, минимум ${limits.minSlides}`);

  const known = new Set((opts.existing ?? []).map((s) => s.id));
  const used = new Set<string>();
  const slides = list.map((raw, i) => {
    const s = normalizeSlide(raw, deck ? deckKindAt(i, list.length) : kindAt(i, list.length), illustrated, Boolean(opts.meme), deck);
    if (opts.meme) Object.assign(s, { title: memeLine(s.title), body: memeLine(s.body), bullets: s.bullets.map(memeLine) });
    if (s.id && (!known.has(s.id) || used.has(s.id))) s.id = undefined;
    if (s.id) used.add(s.id);
    return s;
  });
  slides.forEach((s, i) => {
    if (!s.title) fatal.push(`карточка ${i + 1}: пустой заголовок`);
    problems.push(...slideProblems(s, i + 1, illustrated, Boolean(opts.meme), Boolean(deck)));
  });
  problems.push(...repetitionProblems(slides));

  const visual = illustrated ? normalizeVisual(json?.visual) : undefined;
  if (illustrated && !opts.existing && (!visual || !visual.style)) problems.push("нет общей визуальной концепции visual (style, palette, lighting, characters)");

  const split = splitTrailingHashtags(cleanCaption(json?.caption));
  const rawTags = Array.isArray(json?.hashtags) ? json.hashtags : typeof json?.hashtags === "string" ? [json.hashtags] : [];
  let hashtags = normalizeHashtags([...rawTags, ...split.tags]);
  const caption = cleanCarouselCaption(split.caption);
  if (!caption) problems.push("пустая подпись caption");
  problems.push(...captionProblems(caption, hashtags).map((x) => `caption: ${x}`));
  if (deck && caption) problems.push(...deckCaptionProblems(caption, hashtags, deck.channel).map((x) => `caption: ${x}`));
  // Instagram с декабря 2025 принимает не больше пяти хэштегов: лишние не уходят в пост, даже если исправление не удалось
  if (deck) hashtags = hashtags.slice(0, DECK_TEXT.hashtags[1]);

  const title =
    cleanText(stripEmphasis(String(json?.title ?? "")), { max: CAROUSEL_LIMITS.titleMax }) ||
    cleanText(stripEmphasis(slides[0]?.title ?? ""), { max: CAROUSEL_LIMITS.titleMax });

  return {
    draft: {
      title,
      story: stringList(json?.story, limits.maxSlides, 200),
      slides,
      caption,
      hashtags,
      claimsToCheck: stringList(json?.claimsToCheck, CAROUSEL_LIMITS.claimsMax, 240),
      summary: cleanText(json?.summary, { max: 300 }),
      visual,
    },
    problems: uniq(problems.filter((x) => !fatal.includes(x))),
    fatal: uniq(fatal),
  };
}

/**
 * Замечания к правке по поручению — только о том, что правка затронула. Старые превышения
 * длины в нетронутых карточках повторным запросом не «исправляются»: иначе GPT
 * переписывает то, о чём автор не просил.
 */
export function editProblems(parsed: Parsed, current: Pick<Carousel, "slides" | "caption" | "hashtags">): string[] {
  const same = (d: DraftSlide) => {
    const old = d.id ? current.slides.find((s) => s.id === d.id) : undefined;
    return Boolean(old && old.kind === d.kind && old.kicker === d.kicker && old.title === d.title && old.body === d.body && old.cta === d.cta && JSON.stringify(old.bullets) === JSON.stringify(d.bullets));
  };
  const changed = new Set(parsed.draft.slides.map((d, i) => (same(d) ? -1 : i + 1)).filter((n) => n > 0));
  const captionChanged = parsed.draft.caption !== current.caption || parsed.draft.hashtags.join(" ") !== current.hashtags.join(" ");
  return parsed.problems.filter((p) => {
    const one = p.match(/^карточка (\d+):/);
    if (one) return changed.has(Number(one[1]));
    const pair = p.match(/^карточки (\d+) и (\d+):/);
    if (pair) return changed.has(Number(pair[1])) || changed.has(Number(pair[2]));
    if (/^caption|^пустая подпись/.test(p)) return captionChanged;
    return true;
  });
}

/**
 * Лишние содержательные карточки после исправления убираются, чтобы число совпало с заказанным.
 * У карусели по скиллу остаются итог и финал — убираются последние мысли.
 */
export function fitSlideCount(draft: Draft, expected: number, meme = false, deck?: DeckContext): Draft {
  if (draft.slides.length <= expected) return draft;
  const tail = deck ? 2 : 1;
  const kept = [...draft.slides.slice(0, expected - tail), ...draft.slides.slice(-tail)];
  const story = deck ? [...draft.story.slice(0, expected - tail), ...draft.story.slice(draft.slides.length - tail, draft.slides.length)] : draft.story.slice(0, expected);
  return {
    ...draft,
    slides: kept.map((s, i) => normalizeSlide(s, deck ? deckKindAt(i, kept.length) : kindAt(i, kept.length), Boolean(s.image), meme, deck)),
    story,
  };
}

/** Разбор ответа с одной переписанной карточкой. */
export function normalizeRegenerated(
  json: any,
  c: Pick<Carousel, "slides">,
  index: number,
  illustrated = false,
  meme = false,
  deck?: DeckContext,
): { slide: DraftSlide; claims: string[]; problems: string[]; fatal: string[] } {
  const target = c.slides[index];
  const slide = normalizeSlide(json?.slide ?? json, target.kind, illustrated, meme, deck);
  if (meme) Object.assign(slide, { title: memeLine(slide.title), body: memeLine(slide.body), bullets: slide.bullets.map(memeLine) });
  const fatal = slide.title ? [] : ["пустой заголовок"];
  const problems = slideProblems(slide, index + 1, illustrated, meme, Boolean(deck)).filter((x) => !x.endsWith("пустой заголовок"));
  const others: DraftSlide[] = c.slides.map((s, i) => (i === index ? slide : { ...s, image: s.image ? { brief: s.image.brief, composition: s.image.composition, textPlacement: s.image.textPlacement } : undefined }));
  problems.push(...repetitionProblems(others).filter((x) => new RegExp(`\\b${index + 1}\\b`).test(x)));
  return { slide, claims: stringList(json?.claimsToCheck, CAROUSEL_LIMITS.claimsMax, 240), problems: uniq(problems), fatal };
}
