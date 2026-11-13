// Шаг 1: найти громкую историю, у героя которой есть свои ролики, и скачать их.
import fs from "node:fs";
import path from "node:path";
import { channelResults, resultsBrief } from "./insights";
import { claudeJson } from "./llm";
import type { Stock } from "./stock";
import { duration, hasVideo, mapLimit, python, readJson, run, writeJson, type Hooks } from "./util";

export type Hero = { name: string; handle: string; platform: "tiktok" | "instagram" | "youtube"; gender: "female" | "male"; language: string };
/** Оценка редактора (rateCandidates): насколько история громкая для зрителя 14–30 лет. */
export type Rating = {
  /** 1–10; в запас идут от MIN_SCORE. */
  score: number;
  /** Что в истории знакомо каждому: «MrBeast», «Вазелин», «Майнкрафт». */
  anchor: string;
  /** Первая фраза ролика в подаче автора: сначала якорь или контраст, потом герой. */
  hook: string;
  /** Почему такая оценка, одной фразой: владелец читает её на сайте, когда выбирает историю. */
  verdict: string;
  /**
   * Кому зритель перешлёт ролик и с какими словами («другу, с которым гоняли в Underground: смотри, она в браузере»);
   * «некому» — пересылать незачем. Разбор 10.11: рилсы без пересылок застревают на 200–300 просмотрах.
   */
  share?: string;
};
export type Candidate = {
  title: string;
  summary: string;
  why: string;
  hero: Hero;
  facts: { text: string; source: string }[];
  videos: { url: string; shows: string }[];
  searchTerms: string[];
  /** Продолжение истории, которая уже была на канале (sequels.ts): её зачин и сколько она набрала. */
  sequelOf?: { title: string; hook: string; views?: number };
  rating?: Rating;
  /** Направление поиска, где история нашлась (LANES). */
  lane?: string;
};
export type SourceClip = { key: string; url: string; file: string; duration: number; views: number | null; title: string; date: string | null; shows: string };
export type FoundStory = { candidate: Candidate; clips: SourceClip[] };
/** Вкус владельца по запасу на сайте: что он выбрал для ролика и что отклонил («Не то»). */
export type Taste = { chosen: string[]; rejected: string[] };

/** Истории слабее в запас не идут: владелец 29.10 — «всем похуй, что Родриго оплатила учёбу». */
export const MIN_SCORE = 8;

/**
 * Направления поиска: идут разом, каждое приносит свои истории (владелец 29.10: «что-то популярное сильно,
 * инфоповоды всемирные, мега-новости», «источники нужны все возможные»).
 */
export const LANES = [
  {
    id: "world",
    name: "мировые инфоповоды",
    brief: "то, о чём сейчас говорит весь мир: звёзды мирового уровня, гиганты-бренды, большие игры, громкие события в технологиях, спорте и шоу-бизнесе. Где искать: Reuters, AP, BBC, CNN, The Verge, Variety, TMZ, ESPN, IGN, Kotaku, Dexerto, Google News — а потом ролики самих участников в TikTok и YouTube.",
  },
  {
    id: "internet",
    name: "что взорвало интернет",
    brief: "ролики и тренды, которые за последние недели набрали десятки миллионов в TikTok, Reels, YouTube Shorts и X: реакции брендов и звёзд на обычных людей, войны в комментариях, челленджи, которые повторяет весь мир. Где искать: Know Your Meme, Reddit (r/OutOfTheLoop, r/all, r/TikTokCringe), Daily Dot, Dexerto, Distractify, BuzzFeed, Mashable, Insider, NY Post, People, Today.",
  },
  {
    id: "ru",
    name: "рунет и СНГ",
    brief: "то, что обсуждает русскоязычный интернет, и мировые истории с русской или СНГ-связью: блогер-миллионник приехал в Узбекистан или Казахстан, мировая звезда заговорила по-русски, ролик из России или СНГ разлетелся по миру, новость прямо касается зрителя (учёба, работа, деньги, игры, сервисы). Где искать: Пикабу, DTF, VC.ru, Лента, РБК, Kod, Telegram-каналы про интернет и мемы, русский TikTok и YouTube.",
  },
] as const;

/**
 * Крипта: два ролика из шести (владелец 3.11: «2 из 6 роликов нужно делать про криптовалюту, что-то популярное, свежее
 * и набирающее просмотры, 1 прикольный смешной, другой новостной формат»). Канал — OWNER CRYPTO, в шапке — телеграм
 * владельца про трейдинг. Очередь держит stock.ts (cryptoDue), здесь — что искать.
 */
export const CRYPTO_LANES = [
  {
    id: "crypto-fun",
    name: "крипта — смешное",
    brief: "смешная история из мира крипты за последние 1–2 месяца, которую со смехом перескажет и человек без криптокошелька. Канал называется OWNER CRYPTO, и одна история из шести — такая. Знакомое каждому — биткоин, Илон Маск и Dogecoin, Трамп и его монета, Дуров и Telegram, Хомяк и Notcoin, Binance — и абсурдный поворот одной фразой: мемкоин про мем вырос в тысячи раз, а его создатель продал всё в первый час; кто-то перевёл миллион не на тот адрес и получил его назад с запиской; ИИ-бот с собственным кошельком стал миллионером; бренд или звезда выпустили монету, и всё пошло не так, как задумали. В кадре — кадры самого события или его героя: официальный ролик, интервью, телерепортаж, пост первого лица в X; пересказ крипто-блогера в кадр не идёт (владелец 4.11). Где искать: X (крипто-твиттер), Reddit (r/CryptoCurrency, r/Bitcoin, r/wallstreetbets), Know Your Meme, Decrypt, Cointelegraph, CoinDesk, Protos, The Block, ForkLog, Incrypted, Bits.media, РБК-Крипто, русский и английский крипто-TikTok.",
  },
  {
    id: "crypto-news",
    name: "крипта — новости",
    brief: "главная крипто-новость последних 1–2 недель, которую сейчас обсуждают все крипто-издания и которая набирает просмотры в Shorts и TikTok. Канал называется OWNER CRYPTO, и одна история из шести — такая новость. Лучше всего заходит новость про деньги самого зрителя — про биржу, кошелёк, стейблкоин или приложение, которыми он пользуется сам: в Инстаграме владельца «В кошельках Ledger нашли чип-шпион» набрал 162 тыс., «Взлом Binance» — 17 тыс., «У USDT есть кнопка „заморозить“» — 5 тыс., а суды и чужие разборки — по 2 тыс. Сильные поводы: биткоин обновил рекорд или рухнул за день, взломали крупную биржу, биржа уходит из России или Казахстана и деньги нужно вывести, Telegram и Дуров запустили что-то с TON, страна или компания-гигант купили биткоин, Маск или Трамп сделали ход, от которого дёрнулся рынок. Что это значит для обычного человека — понятно одной фразой. В кадре — официальные видео (владелец 4.11: «искать видео офф источников, интервью офф лица, либо из новостей»): интервью или заявление первого лица (глава биржи, Tether, регулятор, сам Маск), официальный ролик компании, телерепортаж (CNBC, Bloomberg, Fox Business, РБК, Россия 24); пересказ блогера в кадр не идёт. Историю без такого видео не бери. Где искать: CoinDesk, Cointelegraph, The Block, Decrypt, Bloomberg Crypto, Reuters, Wu Blockchain в X, ForkLog, Incrypted, Bits.media, РБК-Крипто, Google News.",
  },
] as const;
export type Lane = (typeof LANES)[number] | (typeof CRYPTO_LANES)[number];
export const isCrypto = (lane: string | undefined): boolean => CRYPTO_LANES.some((l) => l.id === lane);
export const cryptoName = (lane: string | undefined): string | undefined => CRYPTO_LANES.find((l) => l.id === lane)?.name;

const STORY_SYSTEM = `Ты — редактор канала коротких роликов в духе TikTok @darvin.ya («Последняя извилина»): голос автора за кадром за 35–42 секунды пересказывает по-русски громкую историю из интернета, а в кадре идут ролики её героя. Зрители — русскоязычные, 14–30 лет.

Что смотрят миллионы. Самые просматриваемые ролики автора — про то, что зритель уже знает и любит, или про то, что касается его самого:
- MrBeast пришёл на шоу, где предприниматели выпрашивают у богачей инвестиции, — 1,8 млн просмотров;
- бабушка села играть в хоррор-мод Майнкрафта — 1,8 млн;
- MrBeast поехал путешествовать и из всех стран выбрал Узбекистан — 1,4 млн;
- Майнкрафт впервые за 17 лет показал то, чего в игре никогда не было, — 1,1 млн;
- муж Энн Хэтэуэй как две капли похож на Шекспира — 1,1 млн;
- Роскомнадзор за ночь положил почти все VPN — 970 тыс.;
- девушка разбила арендованную машину и показывала ремонт в TikTok, а за ней следила сама компания — 800 тыс.;
- мужчина правда говорит на 42 языках — 790 тыс.
На нашем канале — то же правило, и цифры его подтверждают (разбор всех роликов канала 3.11.2026). Залетают истории, где зритель в первой фразе узнаёт своё — вещь, бренд, игру, мем, свою страну — и сразу слышит про это неожиданный факт:
- «32-летний парень приехал к каменной арке «Целующиеся слоны»…» — 856 тыс.;
- «Беспилотное такси с искусственным интеллектом сдало полиции собственных пассажиров» — 821 тыс.;
- «Как так вышло, что мяч на чемпионате мира превратился в айфон?» — 596 тыс.;
- «81-летняя бабушка перепутала машину на парковке и с пистолетом выгнала из чужой…» — 431 тыс.;
- «Зачем футболисты специально вырезают огромные дыры в бутсах?» — 375 тыс.;
- «Вот эта кореянка заставила Вазелин сменить название» — 198 тыс.;
- «Казахстан начал возвращать тигров туда, где их уничтожили 80 лет назад» — 1,75 млн; «Парень из СССР создал часы за 20 миллионов, их носит Роналду» — 1,47 млн.
А звезда, которая делает то, что от неё и ждут, проходит мимо, как бы громко ни звучало имя: MrBeast трижды, IShowSpeed, Хайди Клум, Кардашьян, Том Круз, Моуринью — у всех 2–11 тыс.; спортивные итоги и чужая политика — 1–3 тыс. Звезда работает, только когда с ней случилось неожиданное.

Сильная история держится на трёх вещах:
1. Знакомое и неожиданное вместе: вещь, бренд, игра или сервис, которые есть у каждого (Вазелин, айфон, Bugatti, Майнкрафт, Марио, ChatGPT, такси, бутсы), мем, который узнают с одной фразы, или «наши» (Казахстан, Россия, СССР) — и с ними случилось то, чего не бывает: обычный человек их изменил, техника поступила как человек и это обернулось против людей, у привычной вещи нашлась странная причина, бренды сцепились друг с другом. Или история прямо касается денег и жизни зрителя (взлом биржи, блокировки).
2. Поворот, который пересказывается одной фразой, — и хочется узнать, чем кончилось.
3. Свои кадры: ролики героя, где главное видно и слышно. Герой — тот, чьи ролики покажут событие: сам человек, бренд со своим аккаунтом, или автор, который снял событие. TikTok лучше всего, потом YouTube Shorts и Reels.
4. Её пересылают. Лента показывает ролик дальше, когда зрители отправляют его друг другу, и у истории есть адресат и повод (разбор канала 10.11.2026). «NFS Underground 2 ожил прямо в браузере» отправляли друзьям, с которыми в неё гоняли: 1850 пересылок и 127 тыс. просмотров в Инстаграме. «В кошельках Ledger нашли чип-шпион» отправляли тем, у кого такой кошелёк: 2400 пересылок и 171 тыс. А «Казашка поймала очки Шакиры» не переслал никто — и там же ролик остался на 273 просмотрах, хотя первые секунды у него пролистывали так же редко. Пересылают четыре вещи: «это про нас» — общее прошлое, игра, мультик, школа, двор; «это про тебя» — у адресата есть эта вещь, привычка или беда; «ты не поверишь» — невозможный факт о том, что знают оба; «предупреди своих» — то, что касается денег и безопасности близких. В why напиши, кому зритель это отправит и с какими словами.

Истории свежие: последние 1–2 месяца, не старше трёх. Проверяй факты по статьям и указывай ссылку на источник у каждого факта: событие подтверждают хотя бы два независимых источника (сам пост героя — первоисточник; перепечатки одной заметки — один источник), а то, чего нет в источниках, в факты не попадает. Аккаунт героя называй точно, как в адресе (handle без @). Найди и дай 3–5 прямых ссылок на ролики героя про это событие (вида https://www.tiktok.com/@handle/video/<число>): по ним скачиваются кадры для монтажа. Страницы TikTok и YouTube ПК листает сам, а у героя из Instagram берёт только твои ссылки — для него их нужно не меньше трёх.
Зритель видит то, о чём говорит автор, поэтому в videos — ещё и кадры самого события с любых аккаунтов: нарезка стрима на клип-канале («IShowSpeed повалил монстра на стриме»), съёмка с красной дорожки, ролик очевидца, репортаж, репост в X или Reddit, где лежит удалённый оригинал, пост со скриншотом переписки или ответа бренда — прямой ссылкой на ролик или пост (x.com/…/status/<число> подходит). В shows — что именно видно.

Ответ — только JSON:
{"stories":[{"title":"короткий заголовок по-русски","summary":"2–3 предложения по-русски","why":"чем цепляет","hero":{"name":"…","handle":"…","platform":"tiktok|instagram|youtube","gender":"female|male","language":"en|ko|ru|…"},"facts":[{"text":"факт по-русски","source":"https://…"}],"videos":[{"url":"прямая ссылка на ролик героя, если нашёл","shows":"что в нём"}],"searchTerms":["слова из подписей его роликов про это событие"]}]}`;

const label = (c: Candidate) => `${c.title} (@${c.hero.handle})`;

/** Что владелец выбирал и отклонял на сайте — строки для задания поиску и редактору. */
function tasteBrief(taste: Taste): string {
  const parts = [
    taste.chosen.length ? `Владелец сам выбрал для ролика:\n${taste.chosen.map((t) => `- ${t}`).join("\n")}` : "",
    taste.rejected.length ? `Владелец отклонил («не то»):\n${taste.rejected.map((t) => `- ${t}`).join("\n")}` : "",
  ].filter(Boolean);
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

/**
 * Истории одного направления поиска (LANES); уже сделанные, уже найденные, пропущенные и отклонённые (exclude) не
 * повторяются.
 */
export async function findCandidates(lane: Lane, exclude: string[], taste: Taste, log: (line: string) => void): Promise<Candidate[]> {
  const results = await channelResults();
  const liked = results.length ? `\n\nКак зашли ролики канала (лучшие сверху):\n${resultsBrief(results)}` : "";
  const user = `Ищи сейчас в одном направлении — ${lane.name}: ${lane.brief}\n\nНайди 3 истории. Уже были на канале или уже найдены, их не бери:\n${exclude.length ? exclude.map((h) => `- ${h}`).join("\n") : "- (пока ничего)"}${liked}${tasteBrief(taste)}`;
  const started = Date.now();
  const res = await claudeJson<{ stories: Candidate[] }>(STORY_SYSTEM, user, { web: true, task: "news-story" });
  const stories = (res.stories ?? []).filter((s) => s?.hero?.handle && s.title).map((s) => ({ ...s, lane: lane.id }));
  if (!stories.length) throw new Error(`Поиск «${lane.name}» не нашёл ни одной подходящей истории`);
  log(`${lane.name} (${Math.round((Date.now() - started) / 60_000)} мин): ${stories.map(label).join("; ")}`);
  return stories;
}

const JUDGE_SYSTEM = `Ты — главный редактор канала коротких роликов в духе TikTok @darvin.ya: голос автора по-русски пересказывает громкую историю из интернета поверх роликов её героя. Зрители — русскоязычные, 14–30 лет. Тебе приносят истории-кандидаты; оцени каждую так, как её встретит зритель, листающий ленту: остановится ли он на первой фразе и захочет ли переслать другу.

Шкала score:
- 9–10 — знакомое каждому (вещь, бренд, игра, мем, наша страна) и с ним случилось невозможное, что хочется пересказать: беспилотное такси сдало полиции своих пассажиров (821 тыс. у нас), обычная кореянка заставила Вазелин сменить название (198 тыс.), Казахстан вернул тигров в дикую природу (1,75 млн), Майнкрафт впервые за 17 лет показал небывалое (1,1 млн у автора).
- 7–8 — знакомое есть, но поворот слабее; или поворот сильный, но вещь знают не все.
- 5–6 — звезда делает то, чего от неё и ждут (MrBeast снял ещё одно испытание, звезда пришла на Хэллоуин в костюме): у нас такие ролики набирают 2–11 тыс., как бы громко ни звучало имя.
- 3–5 — забавно, но местно: незнакомый человек, нишевый магазин или конкурс, повод, о котором в России не слышали. «Студентке оплатила семестр Оливия Родриго» — 320 просмотров у нас, «парень нанял ведьму с Этси, чтобы найти работу» — 23.
- 1–2 — скучно, грустно, тревожно (задержания, суды и штрафы, политика, война — зритель листает дальше, а каналу это лишний риск) или непонятно без долгих объяснений.

Для каждой истории:
- anchor — что в ней знакомо зрителю, одним-тремя словами («MrBeast», «Вазелин», «Майнкрафт», «блокировки VPN»);
- hook — первая фраза ролика в подаче автора, до 12 слов: знакомое и сразу неожиданный факт про него, факт, а не обещание — «Беспилотное такси сдало полиции собственных пассажиров», «Вот эта кореянка заставила Вазелин сменить название»; обычный человек — словами «вот этот / вот эта». Например: «Вазелин есть в каждом доме. И вот эта кореянка заставила его сменить название.», «Пару недель назад MrBeast поехал путешествовать и из всех стран выбрал Узбекистан.», «Сорок два языка звучит как враньё. Но вот этот мужчина правда на них говорит.»;
- verdict — одной фразой, почему такая оценка;
- share — кому зритель перешлёт этот ролик и с какими словами, одной фразой: «другу, с которым гоняли в Underground: смотри, она теперь в браузере», «маме: проверь, не твой ли это крем», «в рабочий чат: такси сдало пассажиров полиции», «тому, кто держит крипту на телефоне: проверь айфон». Если пересылать некому и незачем, так и напиши: «некому».

Пересылка решает, пойдёт ли ролик дальше первых зрителей (разбор канала 10.11.2026). «NFS Underground 2 ожил в браузере» — 1850 пересылок и 127 тыс. просмотров в Инстаграме; карусель «В кошельках Ledger нашли чип-шпион» — 2400 пересылок и 171 тыс.; у 31 рилса из 85 пересылок почти не было, и все они остались на 200–300 просмотрах, среди них «Казашка поймала очки Шакиры» и «Хайди Клум залезла в собственную руку». Поэтому сначала ответь себе на вопрос share, потом ставь score: история с ясным адресатом и поводом («это про нас», «это про тебя», «ты не поверишь», «предупреди своих») при прочих равных получает на балл больше соседней; история, которую некому переслать, — на балл меньше и выше 8 не поднимается.

Канал называется OWNER CRYPTO, и два ролика из шести на нём — про крипту: такие истории помечены [крипта — смешное] или [крипта — новости]. Мерка у них та же — остановится ли зритель на первой фразе, — а сравнивай их с другими крипто-историями:
- 9–10 — крипто-история, которую перескажет и человек без кошелька: знакомое (биткоин, Илон Маск, Трамп, Дуров и Telegram, Binance, Хомяк) и невозможный поворот — парень выбросил жёсткий диск с 8000 биткоинов и годами просит раскопать свалку; для новостей — главная крипто-новость недели про деньги самого зрителя: «В кошельках Ledger нашли чип-шпион» (162 тыс. в Инстаграме владельца), биржа уходит из России и Казахстана, биткоин обновил рекорд, взломали Binance (17 тыс.);
- 7–8 — понятно и интересно тем, кто уже в крипте;
- 5–6 — рядовое движение курса, прогноз аналитика, новая монета на бирже;
- 1–3 — чужие суды и разборки (2 тыс.), реклама проекта, то, что без долгого объяснения не понять.
Смешная история смешит пересказом в одну фразу, новость — свежая, этой недели.

Если в задании есть выбор и отказы владельца канала — это его вкус: похожие на выбранные оценивай выше, похожие на отклонённые — ниже.

Ответ — только JSON: {"ratings":[{"n":1,"share":"…","score":8,"anchor":"…","hook":"…","verdict":"…"}]}`;

const VERIFY_SYSTEM = `Ты фактчекер канала коротких роликов. Перед тобой история, которую хотят пересказать в ролике, её факты со ссылками и ролики. Открой источники и поищи сам:
1. Само событие подтверждают хотя бы два независимых источника — издания, первоисточник (пост или ролик самого героя), официальный аккаунт. Перепечатки одной заметки — один источник. Похожее событие с другим человеком или в другой год — не подтверждение.
2. Есть видео самого события: ролик героя или съёмка момента, где видно то, о чём история.
3. Каждый факт есть в источниках; факт, которого там нет или который там другой, выпиши в wrong слово в слово.
Если найдёшь ещё ролики или посты, где событие видно (нарезка на клип-канале, съёмка с дорожки, репост со скриншотом), дай их прямыми ссылками в videos.
Ответ — только JSON: {"ok":true,"why":"коротко, чем подтверждено или чего не хватает","sources":["https://…","https://…"],"wrong":["факт слово в слово"],"videos":[{"url":"https://…","shows":"что видно"}]}`;

/**
 * Проверка сильных историй перед запасом: два независимых источника, видео события, факты из источников (владелец 1.11:
 * поиск выдумал «Гарри Стайлза в костюме крысы»). Не подтвердилась — в запас не идёт; неверные факты убираются, найденные
 * ролики события добавляются. Сбой проверки историю не теряет: она идёт как есть.
 */
export async function verifyCandidates(list: Candidate[], log: (line: string) => void): Promise<Candidate[]> {
  const checked = await mapLimit(list, 3, async (c): Promise<Candidate | null> => {
    const user = `История: ${c.title}\n${c.summary}\nГерой: ${c.hero.name} (@${c.hero.handle}, ${c.hero.platform})\nФакты:\n${c.facts.map((f) => `- ${f.text} (${f.source})`).join("\n")}\nРолики:\n${c.videos.map((v) => `- ${v.url} — ${v.shows}`).join("\n") || "- нет"}`;
    try {
      const r = await claudeJson<{ ok?: boolean; why?: string; wrong?: unknown[]; videos?: { url?: unknown; shows?: unknown }[] }>(VERIFY_SYSTEM, user, { web: true, task: "news-verify", effort: "medium" });
      if (r.ok === false) {
        log(`история «${c.title}» не подтвердилась: ${String(r.why ?? "").slice(0, 300)}`);
        return null;
      }
      const wrong = new Set((r.wrong ?? []).filter((x): x is string => typeof x === "string").map((x) => x.trim()));
      const known = new Set(c.videos.map((v) => v.url));
      const more = (r.videos ?? []).flatMap((v) => (typeof v.url === "string" && /^https?:\/\//.test(v.url) && !known.has(v.url) ? [{ url: v.url, shows: String(v.shows ?? "") }] : []));
      if (wrong.size || more.length) log(`проверка «${c.title}»: убрано фактов ${wrong.size}, добавлено роликов события ${more.length}`);
      return { ...c, facts: c.facts.filter((f) => !wrong.has(f.text.trim())), videos: [...c.videos, ...more].slice(0, 10) };
    } catch (error) {
      log(`проверка «${c.title}» не прошла (${(error as Error).message.slice(0, 120)}) — история идёт как есть`);
      return c;
    }
  });
  return checked.filter((c): c is Candidate => c !== null);
}

/** Оценка каждой истории отдельным запросом: сам поиск свои находки хвалит, а этот редактор их только сравнивает. */
export async function rateCandidates(list: Candidate[], taste: Taste, log: (line: string) => void): Promise<Candidate[]> {
  if (!list.length) return [];
  const user = `Истории:\n${list.map((c, i) => `${i + 1}. ${cryptoName(c.lane) ? `[${cryptoName(c.lane)}] ` : ""}${c.title} — герой @${c.hero.handle} (${c.hero.platform})\n   ${c.summary}\n   Чем цепляет: ${c.why}`).join("\n")}${tasteBrief(taste)}`;
  const res = await claudeJson<{ ratings: { n: number; score: number; anchor: string; hook: string; verdict: string; share?: string }[] }>(JUDGE_SYSTEM, user, { task: "news-judge", effort: "medium" });
  const out = list.map((c, i) => {
    const r = (res.ratings ?? []).find((x) => Number(x.n) === i + 1);
    const score = Number(r?.score);
    const share = String(r?.share ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    return r && Number.isFinite(score) ? { ...c, rating: { score: Math.max(1, Math.min(10, Math.round(score))), anchor: String(r.anchor ?? ""), hook: String(r.hook ?? ""), verdict: String(r.verdict ?? ""), ...(share ? { share } : {}) } } : c;
  });
  log(`оценки: ${out.map((c) => `${c.title} — ${c.rating?.score ?? "?"}${c.rating?.share ? ` (перешлют: ${c.rating.share})` : ""}`).join("; ")}`);
  return out;
}

export type Listed = { id: string; url: string; title: string; views: number | null; date: string | null; duration: number | null };

async function listUrl(url: string, end: number, signal?: AbortSignal): Promise<Listed[]> {
  const { stdout } = await run("yt-dlp", ["--no-warnings", "--flat-playlist", "--playlist-end", String(end), "-J", url], { timeoutMs: 240_000, signal });
  const data = JSON.parse(stdout) as { entries?: Record<string, unknown>[] } | null;
  const handle = url.match(/@([^/?#]+)/)?.[1] ?? "";
  return (data?.entries ?? []).map((e) => {
    const ts = typeof e.timestamp === "number" ? new Date(e.timestamp * 1000).toISOString().slice(0, 10) : null;
    const id = String(e.id);
    const link = typeof e.url === "string" && e.url.startsWith("http") ? e.url : /tiktok/.test(url) ? `https://www.tiktok.com/@${handle}/video/${id}` : `https://www.youtube.com/watch?v=${id}`;
    return { id, url: link, title: String(e.title ?? e.description ?? "").replace(/\s+/g, " ").slice(0, 140), views: typeof e.view_count === "number" ? e.view_count : null, date: ts, duration: typeof e.duration === "number" ? e.duration : null };
  });
}

/**
 * Страницы, где лежат ролики героя: TikTok, YouTube — шортсы и обычные видео (выпуски, где событие, бывают
 * длинными). У героя из Instagram его страницу ПК не листает — ищутся TikTok и YouTube с тем же ником (казах
 * @bydastann 29.10: TikTok не открылся, шортсы на YouTube — да).
 */
function profileUrls(hero: Hero): { url: string; end: number }[] {
  const tiktok = { url: `https://www.tiktok.com/@${hero.handle}`, end: 150 };
  const youtube = [
    { url: `https://www.youtube.com/@${hero.handle}/shorts`, end: 150 },
    { url: `https://www.youtube.com/@${hero.handle}/videos`, end: 40 },
  ];
  return hero.platform === "tiktok" ? [tiktok] : hero.platform === "youtube" ? youtube : [tiktok, ...youtube];
}

/**
 * Последние ролики героя по его страницам (TikTok и YouTube открываются без входа). TikTok через раз не отдаёт
 * страницу по имени («Unable to extract secondary user ID») — тогда она читается по channel_id из любого его ролика.
 */
export async function listProfile(c: Candidate, signal?: AbortSignal): Promise<Listed[]> {
  const { hero } = c;
  const all: Listed[] = [];
  for (const page of profileUrls(hero)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const listed = await listUrl(page.url, page.end, signal);
        if (listed.length) {
          all.push(...listed);
          break;
        }
      } catch {
        /* следующая попытка */
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  if (all.length || hero.platform === "youtube") return all;
  for (const v of c.videos.filter((x) => /tiktok\.com\/@[^/]+\/video\/\d+/.test(x.url))) {
    try {
      const { stdout } = await run("yt-dlp", ["--no-warnings", "--skip-download", "-J", v.url], { timeoutMs: 120_000, signal });
      const channel = (JSON.parse(stdout) as { channel_id?: string }).channel_id;
      if (channel) {
        const listed = await listUrl(`tiktokuser:${channel}`, 150, signal);
        if (listed.length) return listed;
      }
    } catch {
      /* следующий ролик */
    }
  }
  return [];
}

/** Ролик длиннее этого целиком не качается: из него берутся только нужные куски (владелец 29.10: «научи скачивать только нужный кусок, а не весь ролик!»). */
const SHORT_SECONDS = 120;

const PICK_SYSTEM = `Ты монтажёр канала коротких роликов. Перед тобой история и список роликов её героя (дата, просмотры, длительность, подпись), а с пометкой «поиск YouTube» — ролики других каналов про это событие. Выбери 4–7 роликов, из которых получится рассказ: самый первый залетевший ролик события, ролики, где герой сам объясняет или реагирует, и ролики с последствием (реакция бренда, награда, рост аккаунта). Зритель должен увидеть то, о чём рассказ: если само событие снято не у героя — нарезка стрима на клип-канале, съёмка с красной дорожки, репортаж, ролик очевидца, — возьми и его (1–2 таких ролика), подпись и канал должны прямо говорить, что это то самое событие. Короткие ролики (до ${SHORT_SECONDS} секунд) идут целиком. Если событие показано в длинном ролике — выпуске, интервью, видео на YouTube, — бери и его: ПК по субтитрам вырежет из него только нужные куски. Ответ — только JSON: {"videos":[{"id":"…","shows":"что в нём для рассказа"}]}`;

type Pick = { url: string; shows: string; views: number | null; title: string; date: string | null; duration: number | null };

/**
 * Ролики самого события с других каналов YouTube (нарезки стримов, съёмка с дорожки) — по словам из подписей и имени
 * героя (владелец 1.11 о Спиде: «все кадры же есть в интернете, кучу нарезок в тт и инсте есть»).
 */
async function searchEvent(c: Candidate, signal?: AbortSignal): Promise<Listed[]> {
  const terms = c.searchTerms.filter(Boolean);
  const queries = [...new Set([`${c.hero.name} ${terms[0] ?? ""}`.trim(), terms.slice(0, 2).join(" ")].filter((q) => q.split(/\s+/).length >= 2))].slice(0, 2);
  const out: Listed[] = [];
  for (const q of queries) {
    try {
      const { stdout } = await run("yt-dlp", ["--no-warnings", "--flat-playlist", "-J", `ytsearch8:${q}`], { timeoutMs: 120_000, signal });
      const data = JSON.parse(stdout) as { entries?: Record<string, unknown>[] } | null;
      for (const e of data?.entries ?? []) {
        const id = String(e.id);
        if (out.some((x) => x.id === `yt_${id}`)) continue;
        const d = typeof e.duration === "number" ? e.duration : null;
        if (d !== null && d > 900) continue;
        out.push({ id: `yt_${id}`, url: `https://www.youtube.com/watch?v=${id}`, title: `(поиск YouTube, канал ${String(e.channel ?? e.uploader ?? "?")}) ${String(e.title ?? "").replace(/\s+/g, " ").slice(0, 120)}`, views: typeof e.view_count === "number" ? e.view_count : null, date: null, duration: d });
      }
    } catch {
      /* поиск — добавка: без него ролики героя всё равно есть */
    }
  }
  return out;
}

/** Ролики героя для рассказа: из списка его страниц, а если списка нет — ссылки, которые нашёл поиск. */
async function pickVideos(c: Candidate, own: Listed[]): Promise<Pick[]> {
  if (!own.length) return c.videos.filter((v) => /^https?:\/\//.test(v.url)).slice(0, 8).map((v) => ({ ...v, views: null, title: "", date: null, duration: null }));
  // ролики, что нашёл поиск, — тоже в выбор: у героя из Instagram его страницу ПК не листает, и главные рилсы
  // (казах у Моуринью, «Not AI, this is Kazakhstan») иначе не попадали в ролик (31.10)
  const known = new Set(own.map((v) => v.url));
  const found = c.videos.filter((v) => /^https?:\/\//.test(v.url) && !known.has(v.url)).map((v, i): Listed => ({ id: `found${i + 1}`, url: v.url, title: `(нашёл поиск) ${v.shows}`, views: null, date: null, duration: null }));
  const listed = [...own, ...found];
  const list = listed.map((v) => `${v.id} | ${v.date ?? "?"} | ${v.views ?? "?"} просмотров | ${v.duration ?? "?"} с | ${v.title}`).join("\n");
  const user = `История: ${c.title}\n${c.summary}\nФакты:\n${c.facts.map((f) => `- ${f.text}`).join("\n")}\nСлова из подписей: ${c.searchTerms.join(", ")}\nРолики, которые нашёл поиск: ${c.videos.map((v) => `${v.url} — ${v.shows}`).join("; ") || "нет"}\n\nРолики героя:\n${list}`;
  const res = await claudeJson<{ videos: { id: string; shows: string }[] }>(PICK_SYSTEM, user, { task: "news-pick", effort: "medium" });
  const byId = new Map(listed.map((v) => [v.id, v]));
  return (res.videos ?? []).map((v) => ({ v: byId.get(String(v.id)), shows: v.shows })).filter((x) => x.v).slice(0, 7).map(({ v, shows }) => ({ url: v!.url, shows, views: v!.views, title: v!.title, date: v!.date, duration: v!.duration }));
}

/** Субтитры ролика строками «[мм:сс] текст» по 10 секунд: по ним выбираются куски длинного ролика. */
async function subtitles(url: string, dir: string, lang: string, signal?: AbortSignal): Promise<string[]> {
  const base = path.join(dir, `subs-${Date.now().toString(36)}`);
  const langs = [...new Set([`${lang}-orig`, lang, "en-orig", "en", "ru"])];
  try {
    await run("yt-dlp", ["--no-warnings", "-q", "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", langs.join(","), "--sub-format", "vtt", "-o", base, url], { timeoutMs: 180_000, signal });
  } catch {
    /* субтитров может не быть */
  }
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(path.basename(base)) && f.endsWith(".vtt"));
  const file = langs.map((l) => files.find((f) => f.endsWith(`.${l}.vtt`))).find(Boolean) ?? files[0];
  if (!file) return [];
  const text = fs.readFileSync(path.join(dir, file), "utf8");
  for (const f of files) fs.rmSync(path.join(dir, f), { force: true });
  const seen: string[] = [];
  const buckets = new Map<number, string[]>();
  for (const block of text.split(/\r?\n\r?\n/)) {
    const m = block.match(/(\d+):(\d\d):(\d\d)\.\d+ -->/);
    if (!m) continue;
    const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    for (const raw of block.split(/\r?\n/).slice(1)) {
      if (raw.includes("-->")) continue;
      const line = raw.replace(/<[^>]+>/g, "").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
      if (!line || seen.slice(-3).includes(line)) continue;
      seen.push(line);
      const b = Math.floor(s / 10) * 10;
      buckets.set(b, [...(buckets.get(b) ?? []), line]);
    }
  }
  return [...buckets].map(([s, lines]) => `[${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}] ${lines.join(" ")}`);
}

const WINDOWS_SYSTEM = `Ты монтажёр канала коротких роликов. Перед тобой история и расшифровка длинного ролика её героя с метками времени (каждая строка — 10 секунд). Выбери 2–3 отрезка по 10–40 секунд, где видно и слышно главное для рассказа: само событие, реакцию героя, развязку. Отрезок начинается чуть раньше нужной фразы и кончается чуть позже. Ответ — только JSON: {"windows":[{"from":секунды от начала ролика,"to":секунды,"shows":"что в отрезке"}]}`;

/** Куски длинного ролика для рассказа — по его субтитрам; без субтитров ролик не берётся. */
async function pickWindows(c: Candidate, p: Pick, dir: string, signal?: AbortSignal): Promise<{ from: number; to: number; shows: string }[]> {
  const subs = await subtitles(p.url, dir, c.hero.language || "en", signal);
  if (!subs.length) return [];
  const user = `История: ${c.title}\n${c.summary}\nФакты:\n${c.facts.map((f) => `- ${f.text}`).join("\n")}\n\nРолик: ${p.title} (${Math.round(p.duration ?? 0)} с) — ${p.shows}\n\nРасшифровка:\n${subs.join("\n")}`;
  const res = await claudeJson<{ windows: { from: number; to: number; shows: string }[] }>(WINDOWS_SYSTEM, user, { task: "news-windows", effort: "medium" });
  return (res.windows ?? [])
    .map((w) => ({ from: Number(w.from), to: Number(w.to), shows: String(w.shows ?? p.shows) }))
    .filter((w) => Number.isFinite(w.from) && Number.isFinite(w.to) && w.from >= 0 && w.to - w.from >= 3 && w.to - w.from <= 60)
    .slice(0, 3);
}

/** Ролик или его кусок (section — секунды от и до: качается только он). */
async function download(url: string, dir: string, key: string, signal?: AbortSignal, section?: { from: number; to: number }): Promise<string | null> {
  const out = path.join(dir, `${key}.mp4`);
  const cut = section ? ["--download-sections", `*${section.from.toFixed(1)}-${section.to.toFixed(1)}`, "--force-keyframes-at-cuts"] : [];
  try {
    await run("yt-dlp", ["--no-warnings", "-q", "-f", "bv*[height<=1920]+ba/b", "--merge-output-format", "mp4", "--max-filesize", "150M", ...cut, "-o", out, url], { timeoutMs: 300_000, signal });
  } catch {
    return null;
  }
  return fs.existsSync(out) ? out : null;
}

/** Горизонтальный ролик — в вертикаль, рамка на человеке на каждом плане (runner/py/vertical.py): монтаж кадрирует по центру. */
async function toVertical(file: string, signal?: AbortSignal): Promise<void> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  const [w, h] = stdout.trim().split(",").map(Number);
  if (!(w > h * 1.05)) return;
  const tmp = file.replace(/\.mp4$/, ".v.mp4");
  // горизонтальный оригинал остаётся рядом (.h.mp4): вертикаль можно пересобрать, не скачивая заново (5.11)
  fs.copyFileSync(file, file.replace(/\.mp4$/, ".h.mp4"));
  await python("vertical.py", [file, tmp, file.replace(/\.mp4$/, ".fit.json")], signal);
  fs.renameSync(tmp, file);
}

/**
 * Роликов героя хватает на рассказ: три, или два, если вместе в них больше минуты (31.10, Том Круз: весь разговор с
 * Крузом — в одном 70-секундном ролике, а задание падало «скачалось роликов 2»).
 */
const enough = (clips: SourceClip[]) => clips.length >= 3 || (clips.length === 2 && clips[0].duration + clips[1].duration >= 60);
/**
 * Историю, которую владелец выбрал сам, делаем и из одного ролика героя от 20 секунд: у Спида в костюме Человека-паука
 * (1.11) был ровно один хэллоуинский ролик на 25 с, и задание падало «скачалось роликов 1».
 */
const enoughChosen = (clips: SourceClip[]) => enough(clips) || clips.reduce((a, c) => a + c.duration, 0) >= 20;

/**
 * Первая история из кандидатов (из запаса — stock.ts), у которой скачалось хотя бы три ролика героя. pick — история,
 * которую владелец выбрал на сайте: тогда только она. chosen — хватит и одного ролика от 20 с (выбор владельца или
 * заготовка истории, которую он будет выбирать).
 */
export async function findStory(workDir: string, stock: Stock, hooks: Hooks, pick?: string, chosen = pick !== undefined): Promise<FoundStory> {
  const cached = path.join(workDir, "story.json");
  if (fs.existsSync(cached)) return readJson<FoundStory>(cached);
  // повтор задания берёт тех же кандидатов, что и первая попытка
  const candidatesFile = path.join(workDir, "candidates.json");
  const again = fs.existsSync(candidatesFile);
  const candidates = again ? readJson<Candidate[]>(candidatesFile) : await stock.take(hooks, pick);
  writeJson(candidatesFile, candidates);
  // «Создать заново» выбранной истории приходит без pick, но кандидат в папке один — это тот же выбор владельца (1.11:
  // повтор Спида падал по строгому правилу «скачалось роликов 1»)
  const ok = chosen || (again && candidates.length === 1) ? enoughChosen : enough;
  const srcDir = path.join(workDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  for (const [ci, c] of candidates.entries()) {
    let clips: SourceClip[] = [];
    // TikTok через раз отдаёт пустую страницу (29.10: GTA 6 и ИИ-фермерша — 0 роликов, со второго раза — 5)
    for (let pass = 0; pass < 2 && !ok(clips); pass++) {
      if (pass) {
        hooks.log(`роликов ${clips.length} — ещё попытка через 20 с`);
        await new Promise((r) => setTimeout(r, 20_000));
      }
      await hooks.step(`Качаем ролики героя: @${c.hero.handle}`, 8 + ci * 2);
      for (const f of fs.readdirSync(srcDir)) fs.rmSync(path.join(srcDir, f), { force: true });
      clips = await fetchClips(workDir, srcDir, c, hooks);
    }
    if (ok(clips)) {
      const found = { candidate: c, clips };
      writeJson(cached, found);
      stock.used(c);
      return found;
    }
    hooks.log(`история «${c.title}» пропущена: скачалось роликов ${clips.length}`);
    stock.skip(c);
    for (const f of fs.readdirSync(srcDir)) fs.rmSync(path.join(srcDir, f), { force: true });
  }
  throw new Error(pick ? "У выбранной истории не скачались ролики героя — выберите на сайте другую" : "Ни для одной найденной истории не удалось скачать ролики героя");
}

/**
 * Пост X без видео — картинками: снимок поста (автор, текст, первая картинка) и каждая следующая картинка отдельно, по
 * 5 секунд неподвижно (разбор пометит их «картинка»). Текст и картинки — через api.fxtwitter.com, без входа.
 */
async function postStills(url: string, dir: string, key: string, hooks: Hooks): Promise<{ file: string; d: number; shows: string }[]> {
  const id = url.match(/status\/(\d+)/)?.[1];
  if (!id) return [];
  try {
    const res = await fetch(`https://api.fxtwitter.com/status/${id}`, { signal: hooks.signal });
    if (!res.ok) return [];
    const tweet = ((await res.json()) as { tweet?: { text?: string; author?: { name?: string; screen_name?: string; avatar_url?: string }; media?: { photos?: { url: string }[] }; views?: number; likes?: number } }).tweet;
    if (!tweet) return [];
    const photos = (tweet.media?.photos ?? []).map((x) => x.url).slice(0, 4);
    const info = path.join(dir, `${key}_post.json`);
    writeJson(info, { text: tweet.text ?? "", name: tweet.author?.name ?? "", handle: tweet.author?.screen_name ?? "", avatar: tweet.author?.avatar_url ?? "", photos, views: tweet.views ?? null, likes: tweet.likes ?? null });
    const out = path.join(dir, `${key}_post`);
    const stdout = await python("post_card.py", [info, out], hooks.signal);
    fs.rmSync(info, { force: true });
    const files = (JSON.parse(stdout.trim().split("\n").pop() ?? "[]") as string[]).filter((f) => fs.existsSync(f));
    return files.map((f, j) => ({ file: f, d: 5, shows: j === 0 ? `снимок поста @${tweet.author?.screen_name ?? "?"}: «${(tweet.text ?? "").replace(/\s+/g, " ").slice(0, 160)}»${tweet.views ? `, ${tweet.views} просмотров` : ""}` : `картинка ${j + 1} из поста` }));
  } catch (error) {
    hooks.log(`пост ${url}: картинки не вышли — ${(error as Error).message.slice(0, 120)}`);
    return [];
  }
}

/** Длина ролика по ссылке без скачивания; null — не узнать. */
async function probeDuration(url: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const { stdout } = await run("yt-dlp", ["--no-warnings", "--skip-download", "--print", "duration", url], { timeoutMs: 90_000, signal });
    const d = parseFloat(stdout.trim().split(/\s+/).pop() ?? "");
    return Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}

/** Ролики героя в src/c1…: короткие целиком, из длинных — 2–3 нужных куска; горизонтальные — в вертикаль. */
async function fetchClips(workDir: string, srcDir: string, c: Candidate, hooks: Hooks): Promise<SourceClip[]> {
  const [own, searched] = await Promise.all([listProfile(c, hooks.signal), searchEvent(c, hooks.signal)]);
  const picks = await pickVideos(c, own.length ? [...own, ...searched] : []);
  // ролики качаются разом; номера c1, c2… — по порядку выбора, только скачавшимся
  const got = await mapLimit(picks.slice(0, 8), 4, async (p, i) => {
    // пост X без видео — снимок поста и его картинки (скриншот переписки, ответ бренда), а не пустое место
    if (/^https?:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/status\/\d+/.test(p.url) && !(await probeDuration(p.url, hooks.signal))) {
      const stills = await postStills(p.url, srcDir, `p${i + 1}`, hooks);
      return stills.map((s) => ({ p, file: s.file, d: s.d, url: p.url, shows: `${p.shows} — ${s.shows}` }));
    }
    // ролик, который нашёл поиск, приходит без длины: длинный выпуск качался целиком и выбрасывался (31.10, новости
    // про MrBeast в Узбекистане), а теперь из него, как из своих длинных роликов героя, берутся нужные куски
    if (p.duration === null) p.duration = await probeDuration(p.url, hooks.signal);
    const parts = (p.duration ?? 0) > SHORT_SECONDS ? (await pickWindows(c, p, srcDir, hooks.signal)).map((w) => ({ ...w, section: w })) : [{ from: 0, to: 0, shows: p.shows, section: undefined }];
    const files: { p: Pick; file: string; d: number; url: string; shows: string }[] = [];
    for (const [j, part] of parts.entries()) {
      const file = await download(p.url, srcDir, `p${i + 1}_${j + 1}`, hooks.signal, part.section);
      if (!file) continue;
      const d = await duration(file);
      if (d < 3 || d > SHORT_SECONDS || !(await hasVideo(file))) {
        fs.rmSync(file, { force: true });
        continue;
      }
      try {
        await toVertical(file, hooks.signal);
      } catch (error) {
        hooks.log(`${path.basename(file)}: вертикаль не вышла, кадр по центру — ${(error as Error).message.slice(0, 120)}`);
      }
      const url = part.section ? `${p.url}${p.url.includes("?") ? "&" : "?"}t=${Math.floor(part.from)}s` : p.url;
      files.push({ p, file, d: await duration(file), url, shows: part.shows });
    }
    return files;
  });
  const clips: SourceClip[] = [];
  for (const g of got.flat().slice(0, 9)) {
    const key = `c${clips.length + 1}`;
    const file = path.join(srcDir, `${key}.mp4`);
    fs.renameSync(g.file, file);
    clips.push({ key, url: g.url, file: path.relative(workDir, file).split(path.sep).join("/"), duration: g.d, views: g.p.views, title: g.p.title, date: g.p.date, shows: g.shows });
    hooks.log(`скачан ${key}: ${g.url} (${g.d.toFixed(1)} с) — ${g.shows}`);
  }
  return clips;
}
