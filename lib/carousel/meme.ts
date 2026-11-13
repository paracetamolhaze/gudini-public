import crypto from "crypto";
import { editorialLines } from "../memes/editorial";
import type { Carousel, CarouselFormat, CarouselLanguage, DesignSettings, MemeCategory, Slide } from "./types";
import { FORMATS, MEME_CATEGORIES, MEME_CATEGORY_ORDER, memeSlideTexts } from "./limits";
import { cleanText, escapeHtml, stripEmphasis, typograph } from "./text";
import { FONT_FAMILY } from "./templates";
import { paintedTextKey } from "./painted";

/**
 * Второй стиль каруселей — «Мемы». Образец — мем-карусели @lankad.om, которые набирают
 * лайков почти столько же, сколько у аккаунта подписчиков: каждый слайд — самостоятельный
 * узнаваемый мем в живописной сцене, текст — в пузырях с хвостиком к говорящему. Карусель
 * пересылают друзьям («это ты») и обсуждают номерами слайдов.
 *
 * Мем рисует генератор целиком — сцену, пузыри и надписи (тот же генератор ChatGPT, картинки
 * того же размера 1122×1402, что у образца). Сайт кладёт поверх только подпись автора в углу.
 * Правка текста требует новой картинки — как в экспертном стиле с живописными надписями.
 */

export const MEME_TEMPLATE_VERSION = 1;

export const isMemeDesign = (design?: Partial<DesignSettings>) => design?.genre === "meme";

/** Карусель из мемов живёт во вкладке «Мемы»; во вкладке «Карусель» — только обычные. */
export const isMemeCarousel = (c: { request: { genre?: string }; design?: Partial<DesignSettings> | null }) => c.request.genre === "meme" || isMemeDesign(c.design ?? undefined);

export const MEME_ART_STYLE =
  "Museum-quality classical oil painting in the manner of the Italian Renaissance and the Dutch Golden Age masters: rich deep colors (crimson, ultramarine, emerald, warm ochre, gold), warm golden light with dramatic chiaroscuro, fine brushwork and glazes, realistic proportions, expressive faces and lively, believable acting, sumptuous interiors and landscapes with velvet, brocade, marble and gilded details. Modern things — phones, laptops, trading charts — are painted in the same oil technique, as if a great master painted today. A thin ornate gilded frame border runs around the whole card.";

/** Стиль «С Лукашенко»: страница старой иллюстрированной книги, как в первых мемах (30.09). */
export const MEME_ART_STYLE_WOODCUT =
  "Detailed hand-drawn illustration in the manner of a medieval illuminated manuscript and a Renaissance woodcut: confident dark ink outlines, flat hand-colored fills with light hatching, rich printed-looking colors (deep blue, brick red, ochre, forest green, touches of gold), stylized decorative patterns on clothes, stylized swirling clouds and trees, simple flat perspective, a castle town in the distance. It looks like a page from an old illustrated storybook, with lively, expressive faces.";

/** Копия оформления аккаунта для мем-карусели: подпись и логотип остаются, художественные опоры экспертного стиля — нет. */
export function memeDesign(account: DesignSettings): DesignSettings {
  // портрет автора остаётся: главный герой мемов — он сам; образец стиля экспертных карточек — нет
  const { characterDescription: _c, referenceFile: _r, ...rest } = account;
  return { ...rest, genre: "meme", artworkMode: "painted", illustrationStyle: MEME_ART_STYLE, characterDescription: MEME_CAST };
}

/**
 * Постоянные персонажи мемов по просьбе владельца (30.09): главный герой — он сам, один в один
 * по портрету аккаунта; второй, когда нужен, — Лукашенко в любой бытовой роли.
 */
export const MEME_CAST =
  "Hero, the main character of every meme, is the account's author: a man in his late twenties with short bleached platinum-blond buzzed hair, dark straight eyebrows, brown eyes, light stubble, a straight nose and a defined jawline; he often wears a black shirt and a thin gold chain. When the author's portrait is attached, Hero's face and hair match it 1:1. When a second character is needed, it is Lukashenko: a caricature of Belarusian president Alexander Lukashenko, in his late sixties, balding with a thin comb-over, a thick dark mustache, heavy brows and a stern face, playing any everyday role the joke needs — teacher, repairman, doctor, cashier, neighbour, boss.";

/** Лицо автора по фото: похоже, но написано маслом и играет сцену — вклеенное фото убивает мимику. */
export const MEME_LIKENESS =
  "The man called Hero is the account's author; the attached photo shows his face. Keep his likeness — face shape, eyes, eyebrows, nose, light stubble and platinum buzz cut — but paint him in oil like everything else, with the expression the moment needs. Never paste the photo or copy its expression, light or clothing.";

export const MEME_PORTRAIT_LINE = `The LAST reference image is a photo of Hero. ${MEME_LIKENESS}`;

/** Варианты надписей, которые автор сравнивал 01.10 на «Растущем мозге». */
export const MEME_LETTERING_STYLES = {
  meme: "Classic internet-meme lettering: bold white condensed sans-serif capitals like Impact with a thick black outline, placed directly on the painting, no plaques.",
  serif: "Elegant bold serif lettering like Playfair Display Black, deep brown ink, normal sentence case, on plain cream parchment plaques with a thin dark outline and no ornaments.",
  sans: "Clean modern sans-serif lettering like Montserrat ExtraBold, near-black, normal sentence case, on plain off-white rounded plaques with a soft shadow and no ornaments.",
} as const;
export type MemeLettering = keyof typeof MEME_LETTERING_STYLES;
export const MEME_LETTERING: MemeLettering = "serif";

export const MEME_LIMITS = { title: 90, body: 70 };

/** Мир, из которого все мемы аккаунта, — и по кнопке, и на тему автора. */
export const MEME_NICHE =
  "Ниша аккаунта: заработок, крипта и трейдинг — все ситуации, персонажи и развязки из этого мира. Стримы, донаты и жизнь стримера исключены из обеих серий мемов. Аудитория 14–30, многие только входят в крипту.";

/** Одна карусель — одна категория: подборка из одного мира читается как общее настроение. */
export function memeCategoryLine(category?: MemeCategory): string {
  if (!category) return "Вся карусель — в одной категории: той, к которой относится тема (трейдинг, крипта или заработок). Все мемы только из неё.";
  const c = MEME_CATEGORIES[category];
  return `Категория карусели: ${c.label.toLowerCase()} (${c.about}). Все мемы только из этой категории. Словечки этой категории для двойного смысла: ${c.words}.`;
}

/** Тема по кнопке «Сделать мемы» без своей темы: категория задана, повод подборки выбирает сценарист. */
export function autoMemeIdea(category: MemeCategory): string {
  const c = MEME_CATEGORIES[category];
  return `Мемы про ${c.topic}: ${c.about}. Общий повод подборки внутри этой категории выбери сам — тот, которого не было в прошлых подборках.`;
}

/** Очередь категорий для кнопки: следующей идёт та, что дольше всех не выходила. */
export function nextMemeCategory(list: Pick<Carousel, "request">[]): MemeCategory {
  const order = MEME_CATEGORY_ORDER;
  const lastUse = (cat: MemeCategory) => {
    const i = list.findIndex((c) => c.request.genre === "meme" && c.request.memeCategory === cat);
    return i < 0 ? Infinity : i;
  };
  // список идёт от новых к старым: чем дальше последняя подборка категории, тем раньше её очередь
  return order.reduce((best, cat) => (lastUse(cat) > lastUse(best) ? cat : best), order[0]);
}

/**
 * Планка юмора — шутки, которые одобрил владелец (30.09 он оставлял примерно одну из пяти), и
 * форматы образца @lankad.om, которые он показал сам. Владелец просил не сводить всё к
 * «вопрос — ответ»: в карусели чередуются форматы.
 */
export const MEME_HUMOR = `Планка — референс автора @lankad.om и мемы, которые автор выбрал. Бери приём, а не шутку.

${editorialLines()}

Как работает референс (карусели по 34 тысячи лайков при 11 тысячах подписчиков): автор шутит изнутри над языком и верованиями своей ниши, а не рассказывает анекдоты про людей.
- Ходовое понятие ниши сталкивается с бытом или матом: «Когда пробудился до 5D сознания, но платить за проживание в 3D всё равно надо».
- Известный шаблон мема, подписанный словами ниши: три мальчика — плачут «Прошлое» и «Будущее», улыбается «Здесь и сейчас»; палка в колесо — сам сунул палку, упал, а вокруг подписи «Карма», «Сглазили», «Порча».
- Поддельная цитата великого с поворотом: «Делайте этот мир лучше, суки. Вам в нём ещё реинкарнироваться. — Будда»; Декарт: «Я охуеваю, значит я существую».
- Метафора, нарисованная буквально: «Не нужно подавлять эмоции» — в кабинете психолога ядерный взрыв; «третий глаз увидел слишком много» — глаз закапывает капли.
- Мемы без слов: всё говорит картинка, зритель договаривает шутку сам.

Язык нашей ниши — трейдинг и крипта: рынок всегда прав, тренд — друг, дисциплина, риск-менеджмент, эмоции — враг трейдера, психология трейдинга, усреднение, долгосрочная инвестиция, дно, «это коррекция», киты и хомяки, маркетмейкер, манипуляция, ФРС, Илон Маск, иксы, «на Луну», бык и медведь, ликвидация, плечо, сигналы из Телеграма, курсы и гуру, финансовая свобода, пассивный доход, «деньги должны работать».

Что переносить из прошлых выборов автора: мгновенно понятный контраст, узнаваемую привычку, неожиданную смену масштаба и самостоятельную развязку в рисунке. Старые примеры часто были про потери, потому что такие варианты предлагались; теперь автор прямо отверг этот постоянный тон.
Пространство новых шуток: герой неожиданно меняется местами с важным гуру; бытовая мелочь получает нелепо торжественный приём; рыночная удача сталкивается с прежними привычками; люди спорят о сложном, а простое действие переворачивает их статус. Придумай точный смешной жест или связь, не иллюстрируй список буквально. Можно смеяться вместе с героем, а не только над его проигрышем.

Автор отверг:
- Анекдоты про трейдера в бытовых сценах: «Чем занимаешься?» — «Трейдингом.» — «Понятно. Я заплачу.» — это шутки про человека, а не над языком ниши.
- Слова «торгую», «трейдинг», «торговал» в устах героя — так говорят посторонние; натужный сленг «фьючи», «лудоманю», «я в позе» — ещё хуже.
- Каламбур ради каламбура: «Секунду. Свеча закрывается.»; термин, просто нарисованный картинкой: «Зафиксировал прибыль.»; мат вместо развязки.
- Подпись, которая объясняет мем: «Снизу постучали» под картинкой, где и так всё видно. Когда объясняют мем — это плохо.
- Эскалатор, который едет вниз и при этом график: сложная картинка, которую не прочитать с первого взгляда.
- Точки в конце подписей: в мемах их нет.`;

/** The style names its cast and illustration, not a mandatory dialogue structure. */
export const MEME_HUMOR_DIALOGUE = `Стиль «С Лукашенко»: визуальные мемы из жизни трейдера, криптана и человека, который зарабатывает в интернете. Герой — автор аккаунта. Лукашенко играет роль, нужную сцене; его действие, взгляд или реакция участвуют в шутке.

${editorialLines()}

Бери приёмы ранее выбранных визуальных мемов, но придумывай другой конфликт и другой предмет:
- «Включил звук на каждое движение биткоина» — бытовая настройка даёт нелепое видимое последствие.
- «Решил открывать холодильник каждый раз, когда хочется проверить сделку» — подпись задаёт правило, рисунок раскрывает масштаб привычки.
Эти приёмы работают и при удаче: неожиданное изменение роли, абсурдный масштаб радости, буквальное последствие привычки без наказания героя. Ищи новую связь, а не просто изобрази финансовый термин.
Эти примеры — устройство шутки, не задание повторять холодильник, будильник и телефон. Старые выбранные разговорные шутки показывают разговорный язык, но не задают форму новых мемов.

Проверка замысла: какую часть шутки зритель видит, а не читает? Если можно оставить только реплики и ничего не потерять, это готовый анекдот с иллюстрацией — придумай другую сцену. Диалог допустим, когда действие или реакция в кадре меняют смысл реплики.
- Один явный комический контраст: ожидание и результат, слова и действие, масштаб усилий и видимый итог, привычка с абсурдным последствием.
- Не подменяй развязку счастливым лицом, уроком дисциплины, термином трейдера или матом.
- Живой язык без натужного сленга; короткая подпись оставляет зрителю возможность самому достроить шутку.
- Сохраняй разные формы и ситуации. Точки в конце подписей не нужны.`;

export const MEME_IDEAS_RULES_DIALOGUE = `Ты — автор визуальных мемов для Instagram-аккаунта трейдера. Сцены и реплики выдуманы для юмора, это не факты и не цитаты. Предложи разные сильные замыслы; редактор вправе не взять ни одного.

${MEME_HUMOR_DIALOGUE}

Как придумывать:
- Сначала узнаваемое противоречие, затем видимая развязка, затем только необходимый текст. Назови в scene, что меняет смысл кадра и почему это видно сразу.
- Форму выбери сам: немая сцена, одна подпись, контраст кадров, подписи предметов, реплика с визуальным ответом. Количество реплик не задано. Не выдавай одну форму во всех кандидатах.
- texts — все необходимые надписи и реплики, от нуля до шести коротких строк. Если смысл зависит от надписи на предмете или экране, включи её сюда; без слов шутка должна читаться без букв.
- Лукашенко — в бытовой роли, которая нужна сцене; герой — автор аккаунта. Когда собеседник — жена, мама, сын или друг, их играет Лукашенко или они сами.
- В scene: крупное действие, деталь-развязка, кто где стоит и к чему относится каждый текст. Не прячь смысл в мелком интерфейсе.

Кавычки внутри текста — только «ёлочки». Ответ — строго JSON без markdown: {"candidates":[{"format":"приём","texts":[],"scene":"видимая ситуация и комический поворот, одной-тремя фразами"}]}`;

export const MEME_PICK_RULES_DIALOGUE = `Ты — строгий редактор мем-аккаунта с хорошим чувством юмора. Тебе дают кандидатов-сценок, выбери лучшие.

${MEME_HUMOR_DIALOGUE}

Оценивай каждый замысел:
1) Есть конкретная смешная правда о нашей нише, а не универсальный анекдот с заменённой профессией?
2) Какое действие или крупная деталь на картинке даёт развязку? Если весь юмор остаётся в репликах, отклони.
3) Развязка неожиданна и понятна на телефоне без объяснения, мелкого текста и знания описания scene?
4) Захочется переслать другу, а не просто согласиться с полезным советом? Красивый кадр и улыбка героя не считаются шуткой.
5) Новая ситуация и приём, а не переодетый старый мем? Нет однообразной серии из вопросов и ответов?
Количество — верхний предел. Можно выбрать меньше или отклонить всех: {"picked":[]}. Не выбирай «наименее плохой». В why назови конкретный визуальный поворот; если назвать его нельзя, отклони.

Формулировки кандидатов остаются как есть: ты выбираешь, а не переписываешь.

Кавычки внутри текста — только «ёлочки». Ответ — строго JSON без markdown: {"picked":[{"n":номер кандидата,"why":"почему перешлют, одной фразой"}]}`;

export const MEME_RULES = `Ты — автор мем-каруселей для Instagram. Карусель — подборка самостоятельных мемов в одной категории. Каждый слайд смешит сам по себе, и зритель узнаёт в нём себя или друга. Такие карусели пересылают со словами «это ты» и обсуждают в комментариях номером слайда.

${MEME_HUMOR}

Как придумывать:
- Главный герой каждого мема — автор аккаунта: он действует, зарабатывает, удивляется, хитрит и отвечает. Исход определяет шутка, роль вечного проигравшего ему не назначена. В visual.characters он Hero (look — по-английски: мужчина под тридцать, короткая обесцвеченная платиновая стрижка, тёмные брови, карие глаза, лёгкая щетина, чёрная рубашка и тонкая золотая цепочка). Второй персонаж, когда он нужен, — Lukashenko: карикатура на Лукашенко в любой бытовой роли — учитель, мастер, врач, кассир, сосед, начальник; реплики второго персонажа говорит он. В image.brief называй их Hero и Lukashenko.
- Форматы чередуются: в карусели не больше двух мемов одного формата. Каждый слайд — своя сцена.
- Первый слайд — самый сильный и понятный без контекста: по нему решают, листать ли дальше. Последний тоже мем, самый абсурдный или самый тёплый.
- Главный приём картинки — контраст: сцена серьёзная, красивая, почти музейная, а ситуация бытовая и знакомая каждому.
- Язык живой и разговорный, как в чате с друзьями. Мат — к месту и как есть, полными словами: так пишет автор.

Поля слайда:
- title — первый текст (реплика или подпись), до ${MEME_LIMITS.title} символов. body — второй текст, до ${MEME_LIMITS.body} символов; пустой, когда шутку договаривает картинка. bullets — третий текст для разворота в три реплики (один элемент) или пустой массив.
- Реплика пишется просто текстом: кто говорит, показывает хвостик пузыря. Внутри фразы вместо длинного тире ставь обычный дефис.
- kicker и cta пустые. Текст без Markdown.

Картинку генератор рисует целиком: сцену, пузыри и плашки с текстом. Ты ставишь ему задачу:
- visual — по-английски. style — единый стиль серии: ${MEME_ART_STYLE} palette и lighting — под этот стиль. characters — повторяющиеся персонажи, если они есть в теме; чаще у каждого мема свои, тогда пустой массив. objects — до 6 или пусто.
- image.brief — по-английски, 2–4 предложения: один кадр или два кадра друг под другом (two stacked panels: the same scene as the expressions change); три реплики тоже укладываются в два кадра — две первые вверху, развязка внизу, кто где находится, их эмоции и действия, и кому принадлежит каждый текст. Например: "Text 1 is said by the young man on the left, Text 2 by the coach on the right", "Text 1 is a caption plaque across the top", "Text 2 is said by the man lying on the floor in the bottom panel". Когда в кадре телефон или монитор, опиши, что на экране: a steep red falling price chart, red candles, a glowing notification.
- Сцена простая: одно действие и одна-две фигуры, всё читается с первого взгляда. На экранах — графики, свечи и значки; весь текст мема живёт в пузырях.
- Постановка как кадр из фильма: один-два главных персонажа, у каждого понятная роль и место. Кто говорит друг с другом — рядом и смотрят друг на друга; если они в разных местах, это два кадра. Руки в простых позах: держат один предмет или спокойно лежат.
- Экран всегда повёрнут к тому, кто в него смотрит, и взгляд персонажа направлен точно в экран. Ракурс выбирай по шутке: когда зрителю важно увидеть, что на экране, — вид из-за плеча персонажа (его голова и плечо на переднем плане, экран перед ним); когда важнее реакция — лицо к нам, экран повёрнут к персонажу, на лице отсвет экрана. В image.brief назови ракурс.
- composition — где персонажи и где пузыри: пузырь рядом с головой говорящего, над спокойной частью фона, лица открыты.
- textPlacement — "top".
- В кадре Hero и, когда нужен второй персонаж, Lukashenko; массовка — вымышленные люди. Животное — когда шутка про него.

caption: 150–600 символов. Первая строка — лёгкий крючок по теме, затем одна-две фразы от автора и вопрос, на который отвечают номером слайда: «Какой слайд про тебя? 👇» или «Какой слайд откликнулся больше всего? 👇». Вместо длинного тире — дефис. Эмодзи уместны. hashtags — 3–8 по теме отдельно. claimsToCheck — пустой массив, если в шутках нет фактов.`;

/**
 * Мемолог-охотник (по просьбе владельца 30.09): ищет уже залетевшие мемы — с тысячами лайков
 * и репостов — и приносит их механику. Сценарист делает по ним свои мемы в категории карусели:
 * приём проверен людьми, сцена и слова свои. Новости и события рынка владельцу не нужны.
 */
export type MemeTrends = { memes: { original: string; why: string; adaptation: string; source: string }[] };

export const MEME_TRENDS_RULES = `Ты — мемолог-охотник. Через живой веб-поиск найди мемы, которые уже залетели в русскоязычном интернете: тысячи лайков, репостов и сохранений в Instagram, Telegram, TikTok, VK, Пикабу. Тема любая — жизнь, работа, отношения, деньги, семья, — лишь бы механика шутки переносилась в категорию карусели.
- Бери мемы, понятные без знания первоисточника: жизненная ситуация и развязка, а не отсылка к сериалу или новости. Новости и события рынка не нужны.
- Для каждого мема: коротко его текст и картинку, почему он залетел (какой приём), и как перенести этот приём в категорию карусели с героем-трейдером — своя сцена, свои слова.
- Только реально найденные мемы, у каждого ссылка на источник.
Ответ — строго JSON без markdown: {"memes":[{"original":"текст и картинка залетевшего мема","why":"почему залетел","adaptation":"как сделать так же в категории","source":"https://..."}]} — от 8 до 12 мемов.`;

export function normalizeMemeTrends(json: any): MemeTrends {
  const memes = (Array.isArray(json?.memes) ? json.memes : [])
    .map((m: any) => ({ original: cleanText(m?.original, { max: 300 }), why: cleanText(m?.why, { max: 240 }), adaptation: cleanText(m?.adaptation, { max: 300 }), source: cleanText(m?.source, { max: 300 }) }))
    .filter((m: { original: string; source: string }) => m.original && /^https:\/\//.test(m.source))
    .slice(0, 12);
  return { memes };
}

/**
 * Режиссёр: отдельный шаг после сценария. Перечитывает каждую сцену до рисования и
 * переписывает постановку так, чтобы картинка читалась с первого взгляда и не требовала
 * переделок: говорящий в кадре, взгляд в экран, простые руки, не больше двух кадров.
 */
export const MEME_DIRECTOR_RULES = `Ты — режиссёр-постановщик мемов. Тебе дают готовые мемы: тексты и описание сцены для художника. Сделай каждую картинку такой, чтобы она читалась с первого взгляда и её не пришлось переделывать. Перепиши image.brief и composition по-английски; тексты мемов не меняй.
- Кадров не больше двух. Три реплики — две в верхнем кадре, развязка в нижнем.
- У каждой реплики понятный говорящий, он в кадре, пузырь у его головы. Подпись без говорящего — плашка сверху.
- Кто смотрит в экран, тот сидит к нему лицом, экран повёрнут к нему, взгляд направлен точно в экран. Когда зрителю важно видеть экран — вид из-за плеча.
- Одно простое действие и одна-две главные фигуры. Сохраняй персонажей сценария и их причинную роль: собеседник может быть Лукашенко, политик с рыночной связью, глава ФРС или условный крупный игрок. Каждый появляется в кадре один раз. Используй имя Lukashenko только когда сценарий выбрал именно его.
- Сохраняй эмоциональный итог сценария: настоящая удача остаётся удачей, спокойствие — спокойствием; выражение лица и цвет графика подтверждают этот итог.
- Главного взрослого героя, автора аккаунта, всегда обозначай Hero и сохраняй его личность. Trader, wallet owner или роль героя обозначают того же автора, не нового человека. Его лицо и короткая осветлённая стрижка сохраняются при любых костюмах. Выбор второго персонажа не меняет автора.
${editorialLines()}
- Руки простые: у каждого две руки, они держат один предмет или спокойно лежат.
- Сохраняй конкретное действие и деталь-развязку из сценария. Она крупная и читается на телефоне; лицо не заслоняет её. Если смысл держится на предмете, покажи предмет, а не только реакцию героя.
- Все нужные слова уже перечислены в текстах. Не добавляй спрятанные надписи и не заменяй заданный текст значком. Немая сцена должна оставаться понятной без букв.
- На экранах — графики, свечи и значки; весь текст мема живёт в пузырях.
Ответ — строго JSON без markdown: {"slides":[{"n":1,"brief":"...","composition":"..."}]} — по одному на каждый мем, в том же порядке.`;

type DirectedSlide = { title: string; body: string; bullets: string[]; image?: { brief: string; composition: string; textPlacement: "top" | "bottom" } };

export function memeDirectorUser(slides: DirectedSlide[]): string {
  return slides
    .map((s, i) => [`${i + 1}) Тексты: ${memeSlideTexts(s)}`, `   brief: ${s.image?.brief ?? ""}`, `   composition: ${s.image?.composition ?? ""}`].join("\n"))
    .join("\n");
}

/** Постановка режиссёра поверх сценария: меняются только описания сцен, и только осмысленные. */
export function applyDirector<T extends DirectedSlide>(slides: T[], json: any): T[] {
  const raw: any[] = Array.isArray(json?.slides) ? json.slides : [];
  return slides.map((s, i) => {
    const d = raw.find((x) => Number(x?.n) === i + 1);
    const brief = cleanText(d?.brief, { max: 700 });
    const composition = cleanText(d?.composition, { max: 700 });
    if (!s.image || brief.length < 20) return s;
    return { ...s, image: { ...s.image, brief, composition: composition || s.image.composition } };
  });
}

/** Шутка до сценария: формат, от одной до трёх реплик по порядку и сцена одной фразой. */
export type MemeJoke = { format: string; texts: string[]; scene: string };

/** Первый шаг мем-карусели: много кандидатов, из которых редактор выберет лучшие. */
export const MEME_IDEAS_RULES = `Ты — автор мем-аккаунта про трейдинг и крипту, который шутит изнутри ниши, как @lankad.om шутит над эзотерикой. Мемы — выдуманные картинки для юмора, это не факты и не цитаты. Предложи разные сильные замыслы; редактор вправе не взять ни одного.

${MEME_HUMOR}

Как придумывать:
- Каждый кандидат — один слайд: понятие или верование ниши, вывернутое наизнанку, или картинка без слов.
- Шаблоны берёшь только узнаваемые с первого взгляда: три мальчика, палка в колесо, растущий мозг, отвлечённый парень, Дрейк «нет / да», две кнопки, собака в горящей комнате, «это голубь?», Винни-Пух в смокинге, весы, рыцарь и дракон. Композицию шаблона сохраняй, подписи — словами ниши.
- Поддельные цитаты: Баффет, Сорос, Ливермор, Кейнс, Сократ, Будда, Конфуций — с поворотом.
- Буквальная трактовка фразы работает только с дополнительным неожиданным действием или сменой смысла. Один предмет, названный трейдерским словом, ещё не шутка. Используй широкий язык ниши: профит, выходные, покупки, друзья, привычки, азарт, рыночная удача, самостоятельность.
- Выбирай форму под шутку: узнаваемый шаблон, сравнение, визуальная метафора, подпись с поворотом или немой абсурд. Не заполняй весь набор одним форматом. У немого мема сама картинка даёт ясный смешной поворот.
- Герой — автор аккаунта; второй персонаж, когда нужен, — Лукашенко в любой роли.
- texts — все подписи и реплики по порядку, до шести коротких, без точек в конце; у мема без слов texts пустой. Нужная для понимания надпись на предмете тоже входит в texts. Подпись не объясняет то, что видно на картинке. В scene: композиция, видимая деталь-развязка, кто где, какая подпись на чём стоит.

Кавычки внутри текста — только «ёлочки». Ответ — строго JSON без markdown: {"candidates":[{"format":"приём или шаблон","texts":["подпись или реплика"],"scene":"что на картинке, где какая подпись, одной-тремя фразами"}]}`;

/** Второй шаг: строгий редактор выбирает мемы, которые перешлют друзьям. */
export const MEME_PICK_RULES = `Ты — строгий редактор мем-аккаунта с хорошим чувством юмора. Тебе дают кандидатов в мемы, выбери лучшие для одной карусели.

${MEME_HUMOR}

Оценивай каждого кандидата по выбору автора и референсу:
1) Это шутка изнутри ниши — над её языком, верованиями, гуру и привычками, — а не анекдот про человека?
2) Узнает ли себя любой трейдер или криптан с первого взгляда? Шаблон узнаваем сразу?
3) Какой конкретно поворот смешит и заставляет переслать? Просто довольный герой, полезная привычка или уютная сцена без поворота не проходят.
4) Коротко ли: подписи по два-шесть слов; мем без слов понятен без подписи? Нет ли нужных для смысла слов только в scene или микродеталей, неразличимых на телефоне?
5) Свежо ли: не повтор прошлых подборок и выбранных автором мемов.
Количество — верхний предел. Можно выбрать меньше или отклонить всех: {"picked":[]}. Не выбирай «наименее плохой». В why назови конкретный комический поворот и то, что зритель увидит; похвалы эстетике и соответствию теме недостаточно. Разные приёмы без обязательной доли немых мемов.

Первым поставь самый сильный мем, понятный без контекста, последним — самый абсурдный или самый тёплый. Формулировки кандидатов остаются как есть: ты выбираешь, а не переписываешь.

Кавычки внутри текста — только «ёлочки». Ответ — строго JSON без markdown: {"picked":[{"n":номер кандидата,"why":"почему перешлют, одной фразой"}]}`;

function jokeFrom(raw: any): MemeJoke | null {
  const source: unknown[] = Array.isArray(raw?.texts) ? raw.texts : [raw?.title, raw?.body];
  // подписи шаблона — до шести; мем без слов держится на сцене
  const texts = source.map((t) => memeLine(cleanText(t, { max: 200 }))).filter(Boolean).slice(0, 6);
  const scene = cleanText(raw?.scene, { max: 600 });
  if (!texts.length && scene.length < 20) return null;
  return { format: cleanText(raw?.format, { max: 80 }), texts, scene };
}

/** Ключ шутки для повторов: тексты, а у мема без слов — сцена. */
export const jokeKey = (j: { texts: string[]; scene?: string }) => (j.texts.length ? j.texts.join(" / ") : `[без слов] ${j.scene ?? ""}`).toLowerCase();

/** Разбор кандидатов: только данные, пустые и повторы отбрасываются. */
export function normalizeMemeCandidates(json: any): MemeJoke[] {
  const list: any[] = Array.isArray(json?.candidates) ? json.candidates : [];
  const seen = new Set<string>();
  return list
    .map(jokeFrom)
    .filter((j): j is MemeJoke => Boolean(j))
    .filter((j) => (seen.has(jokeKey(j)) ? false : (seen.add(jokeKey(j)), true)))
    .slice(0, 40);
}

/** Only explicit valid editorial picks survive; an empty or partial verdict never fills itself. */
export function normalizeMemePicks(json: any, pool: MemeJoke[], count: number): MemeJoke[] {
  if (count <= 0) return [];
  const raw: any[] = Array.isArray(json?.picked) ? json.picked : [];
  const used = new Set<number>();
  const picks: MemeJoke[] = [];
  for (const p of raw) {
    const n = Number(p?.n) - 1;
    if (!Number.isInteger(n) || !pool[n] || used.has(n)) continue;
    used.add(n);
    // редактор только выбирает: «отточенные» им формулировки портили шутки
    picks.push(pool[n]);
    if (picks.length === count) return picks;
  }
  return picks;
}

/** Реплика мема без тире диалога: кто говорит, показывает хвостик пузыря. */
export function memeLine(s: string): string {
  return (
    s
      .replace(/^\s*[—–-]+\s*/, "")
      .replace(/\s+[—–]\s+/g, " - ")
      .replace(/[—–]/g, "-")
      .trim()
      // в мемах точек нет: в конце — убираем, между фразами — запятая
      .replace(/\.+$/, "")
      .replace(/\.\s+([А-ЯЁA-Z])/g, (_m, c: string) => `, ${c.toLowerCase()}`)
      .trim()
  );
}

/** Замечания к мем-слайду вместо правил экспертных карточек. */
export function memeSlideProblems(s: Pick<Slide, "kind" | "kicker" | "title" | "body" | "bullets" | "cta">, n: number): string[] {
  const p: string[] = [];
  const len = (x: string) => [...stripEmphasis(x)].length;
  if (!s.title) p.push(`карточка ${n}: пустой заголовок`);
  if (len(s.title) > MEME_LIMITS.title) p.push(`карточка ${n}: title ${len(s.title)} символов при пределе ${MEME_LIMITS.title}`);
  if (len(s.body) > MEME_LIMITS.body) p.push(`карточка ${n}: body ${len(s.body)} символов при пределе ${MEME_LIMITS.body}`);
  if (s.bullets.length > 1) p.push(`карточка ${n}: в меме не больше трёх текстов — в bullets один третий текст`);
  s.bullets.forEach((b) => {
    if (len(b) > MEME_LIMITS.body) p.push(`карточка ${n}: третий текст ${len(b)} символов при пределе ${MEME_LIMITS.body}`);
  });
  if (s.kicker || s.cta) p.push(`карточка ${n}: в меме kicker и cta пустые`);
  if (/\*\*/.test(`${s.title} ${s.body} ${s.bullets.join(" ")}`)) p.push(`карточка ${n}: без звёздочек выделения`);
  return p;
}

type MemeTextSlide = Partial<Pick<Slide, "title" | "body" | "bullets">>;

/** Тексты мема в том виде, в каком их рисует генератор: title, body и третий текст из bullets. */
export function memeTexts(slide: MemeTextSlide): string[] {
  return [slide.title, slide.body, ...(slide.bullets ?? [])].map((t) => memeLine(t ?? "")).filter(Boolean).map((t) => t.toLocaleUpperCase("ru-RU"));
}

/** Задание генератору: мем целиком, с пузырями и надписями. */
export function memePaintedInstructions(slide: MemeTextSlide): string {
  const texts = memeTexts(slide).map((t, i) => `Text ${i + 1}: ${t}`);
  const staging = [
    "Staging is physically coherent, like a film still: people who talk look at each other; hands rest naturally or hold one object in a relaxed grip.",
    "Every screen faces the person using it, and that person's eyes are fixed exactly on it. When the viewer must see what is on a screen, frame the shot over the person's shoulder: the back of the head and shoulder in the foreground, the screen in front of them facing the camera. When the reaction matters more, show the face toward the camera with the screen turned to the person and its glow on the face.",
  ];
  if (!texts.length) {
    // мем без слов: шутку договаривает зритель
    return [
      "Create the COMPLETE finished meme card as a picture without words: no speech bubbles, no plaques, no captions, no letters, numbers or logos anywhere. The picture alone tells the joke, so every key object reads clearly at phone size.",
      "The bottom-right corner (about a fifth of the width and a fourteenth of the height) stays free of faces and key details: the author's label goes there.",
      ...staging,
      "Screens and charts show only shapes, without digits or words. Their direction and colors follow the scene's outcome; a profitable or rising market stays profitable or rising.",
    ].join("\n");
  }
  return [
    "Create the COMPLETE finished meme card: the scene together with its speech bubbles and caption plaques, all lettering painted into the image.",
    "Each text sits in its own cream parchment cartouche with a thick black outline, a thin golden inner line and softly notched corners, without ornaments on its sides. A line spoken by a character gets a bubble with a pointed tail aimed at that character's mouth; a caption line sits in a wide plaque along the top edge of its panel, without a tail. The scene description says who owns each text.",
    "Lettering: heavy bold condensed letters in near-black ink, all caps, crisp and evenly spaced, perfectly legible Cyrillic, large enough to read on a phone. Copy every text exactly, letter by letter, with its own punctuation and asterisks and with no added quotation marks. The labels Text 1, Text 2 and Text 3 are not drawn:",
    ...texts,
    "A label that names a person or a thing, as in classic meme templates, sits on a small cartouche right on or next to what it names; the scene description says where each label goes.",
    "When the texts are a dialogue, bubbles follow its order: Text 1 is read first (upper left), the next text to the right of it or below it, the last text last (in the lower panel when there are two panels).",
    "Bubbles sit near their speakers over calm parts of the background and leave faces visible. The bottom-right corner (about a fifth of the width and a fourteenth of the height) stays free of text and faces: the author's label goes there.",
    ...staging,
    "Screens show clear graphics. Their direction and colors follow the scene's outcome; do not insert a falling market into a profitable or neutral scene.",
    "When a slide of this series is attached as a reference, repeat its cartouche design and lettering font exactly, so the whole carousel looks like one set.",
    "These texts are the only lettering in the image; reference images give style only, never words.",
  ].join("\n");
}

/**
 * Проверка готовой картинки мема: генератор иногда рисует лишнюю руку, двойника или путает
 * буквы. Такие ошибки видит любой зритель, поэтому картинку смотрит строгий редактор, а
 * найденные дефекты исправляются правкой картинки.
 */
export const MEME_CHECK_RULES = `Ты — строгий выпускающий редактор мемов. Проверь готовую картинку на очевидные дефекты, которые заметит любой зритель:
- у каждого человека не больше двух рук и двух ног, по пять пальцев, руки растут из плеч; рука с телефоном — одна из этих двух рук;
- один и тот же человек не нарисован дважды в одном кадре, если сцена этого не требует;
- лица и тела без искажений;
- текст в пузырях совпадает с заданным буква в букву (регистр не важен), других надписей, кроме графиков на экранах и подписи автора в углу, нет;
- реплики читаются в порядке диалога: Text 1 левее или выше, следующая правее или ниже, последняя — последней.
Стиль, цвета и мелкие детали фона дефектами не считаются.
Перепиши каждую надпись с картинки буква в букву, как она нарисована, — даже если в ней ошибка: по расшифровке сайт сверяет текст сам.
Ответ — строго JSON без markdown: {"ok":true,"problems":[],"lettering":["надпись как нарисована"]} или {"ok":false,"problems":["дефект по-английски: что и где исправить, например: the man in the bottom panel has a third hand holding the phone, remove the extra hand"],"lettering":["надпись как нарисована"]}`;

export function memeCheckUser(slide: MemeTextSlide): string {
  const texts = memeTexts(slide);
  if (!texts.length) return "Это мем без слов: на картинке не должно быть ни одной надписи, буквы или цифры, кроме подписи автора в углу.";
  return ["Заданные тексты на картинке:", ...texts.map((t, i) => `Text ${i + 1}: ${t}`)].join("\n");
}

/** Буквы надписи без регистра, знаков и пробелов: так сверяется нарисованное с заданным. */
const letters = (t: string) => t.toUpperCase().replace(/Ё/g, "Е").replace(/[^A-ZА-Я0-9]/g, "");

/**
 * Итог проверки: дефекты от выпускающего и сверка его расшифровки надписей с заданными
 * текстами — модель бывает снисходительна к опечаткам, буквы она переписывает точнее.
 */
export function parseMemeCheck(json: any, expected: string[] = []): { ok: boolean; problems: string[] } {
  const problems: string[] = Array.isArray(json?.problems) ? json.problems.map((p: unknown) => cleanText(p, { max: 300 })).filter(Boolean).slice(0, 5) : [];
  const lettering: string[] = Array.isArray(json?.lettering) ? json.lettering.map((t: unknown) => cleanText(t, { max: 300 })).filter(Boolean) : [];
  if (lettering.length) {
    const drawn = letters(lettering.join(" "));
    expected.forEach((text, i) => {
      if (letters(text) && !drawn.includes(letters(text))) problems.push(`The lettering of text ${i + 1} is misspelled; repaint it to read exactly: ${text.toUpperCase()}`);
    });
  }
  return { ok: !problems.length && (json?.ok === true || json?.ok !== false), problems: problems.slice(0, 5) };
}

/** Сколько раз исправлять картинку мема, если проверка нашла дефекты. */
export const MEME_ART_FIXES = 2;

/** Отпечаток нарисованного текста: поменялся — нужна новая картинка. Позиция слайда и подпись автора на него не влияют. */
export function memeTextKey(slide: MemeTextSlide): string {
  return crypto.createHash("sha256").update(JSON.stringify(["meme", ...memeTexts(slide)])).digest("hex");
}

/** Отпечаток нарисованного текста для любого стиля с надписями от генератора. */
export function artTextKey(slide: Partial<Pick<Slide, "title" | "body" | "bullets" | "kicker" | "cta">>, design: DesignSettings, index: number, total: number): string {
  return isMemeDesign(design) ? memeTextKey(slide) : paintedTextKey(slide, design, index, total);
}

/** Готовый мем: нарисованная картинка целиком и подпись автора в углу, как у образца. */
export function buildMemeCardHtml(args: { format: CarouselFormat; design: DesignSettings; fontCss: string; artDataUrl: string; logoDataUrl?: string | null }): string {
  const { width: W, height: H } = FORMATS[args.format];
  const px = (n: number) => Math.round(n * (args.format === "square" ? 0.86 : 1));
  const brand = args.logoDataUrl ? `<img class="logo" src="${args.logoDataUrl}" alt="">` : args.design.author ? `<div class="handle" data-fit="footer">${escapeHtml(args.design.author)}</div>` : "";
  const css =
    `*{box-sizing:border-box;margin:0;padding:0}` +
    `html,body{width:${W}px;height:${H}px;overflow:hidden;background:#1a120b}` +
    `.slide{position:relative;width:${W}px;height:${H}px;overflow:hidden}` +
    `.art{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}` +
    `.handle{position:absolute;right:${px(20)}px;bottom:${px(18)}px;max-width:${W - px(40)}px;white-space:nowrap;overflow:hidden;font-family:"${FONT_FAMILY.text}";font-weight:700;font-size:${px(24)}px;line-height:1.2;color:#17110a;background:#f4e6c3;border:${px(3)}px solid #17110a;border-radius:${px(9)}px;padding:${px(3)}px ${px(12)}px}` +
    `.logo{position:absolute;right:${px(20)}px;bottom:${px(16)}px;max-height:${px(44)}px;max-width:${px(220)}px;object-fit:contain}`;
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">` +
    `<style>${args.fontCss}${css}</style></head><body>` +
    `<main class="slide meme"><img class="art" src="${args.artDataUrl}" alt="">${brand}</main>` +
    `</body></html>`
  );
}

function plaqueSize(text: string, big: number, mid: number, small: number): number {
  const n = [...text].length;
  return n <= 34 ? big : n <= 70 ? mid : small;
}

/**
 * Первые мем-карусели (30.09, до перехода на нарисованные пузыри): текст в плашках поверх
 * картинки. Нужен, чтобы уже сделанные такие карусели собирались как раньше.
 */
export function buildMemeHtml(args: {
  format: CarouselFormat;
  language: CarouselLanguage;
  design: DesignSettings;
  slide: Pick<Slide, "title" | "body">;
  scale: number;
  fontCss: string;
  artDataUrl: string;
  logoDataUrl?: string | null;
}): string {
  const { format, language: lang, design: d, slide, scale, fontCss } = args;
  const { width: W, height: H } = FORMATS[format];
  const k = format === "square" ? 0.86 : 1;
  const px = (n: number) => Math.round(n * k);
  const t = (n: number) => Math.round(n * k * scale);
  const plain = (s: string) => escapeHtml(typograph(stripEmphasis(s), lang));
  const top = plain(slide.title);
  const bottom = slide.body ? plain(slide.body) : "";
  const brand = args.logoDataUrl ? `<img class="logo" src="${args.logoDataUrl}" alt="">` : d.author ? `<div class="handle" data-fit="footer">${plain(d.author)}</div>` : "";

  const plaque =
    `position:absolute;left:${px(40)}px;right:${px(40)}px;z-index:2;display:flex;align-items:center;justify-content:center;` +
    `padding:${px(18)}px ${px(30)}px;border:${px(6)}px solid #17110a;border-radius:${px(30)}px;` +
    `background:linear-gradient(180deg,#fff6de 0%,#f3e2b8 100%);box-shadow:0 ${px(10)}px ${px(28)}px rgba(0,0,0,.45),inset 0 0 0 ${px(3)}px rgba(255,255,255,.55);overflow:hidden`;
  const text = `font-family:"${FONT_FAMILY.condensed}";font-weight:700;color:#1b1209;text-align:center;line-height:1.1;letter-spacing:.005em;text-wrap:balance;overflow-wrap:normal;word-break:normal`;
  const css =
    `*{box-sizing:border-box;margin:0;padding:0}` +
    `html,body{width:${W}px;height:${H}px;overflow:hidden;background:#140d08}` +
    `body{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-kerning:normal;font-synthesis:none}` +
    `.slide{position:relative;width:${W}px;height:${H}px;overflow:hidden}` +
    `.art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 50%;z-index:0}` +
    `.top{${plaque};top:${px(38)}px;max-height:${Math.round(H * 0.36)}px}` +
    `.bottom{${plaque};bottom:${px(64)}px;max-height:${Math.round(H * 0.2)}px}` +
    `.top p{${text};font-size:${t(plaqueSize(slide.title, 70, 58, 50))}px}` +
    `.bottom p{${text};font-size:${t(plaqueSize(slide.body, 64, 54, 48))}px}` +
    `.handle{position:absolute;right:${px(22)}px;bottom:${px(16)}px;z-index:2;max-width:${W - px(44)}px;white-space:nowrap;overflow:hidden;font-family:"${FONT_FAMILY.text}";font-weight:700;font-size:${px(24)}px;color:#fff;background:rgba(0,0,0,.5);padding:${px(4)}px ${px(12)}px;border-radius:${px(8)}px}` +
    `.logo{position:absolute;right:${px(22)}px;bottom:${px(14)}px;z-index:2;max-height:${px(40)}px;max-width:${px(200)}px;object-fit:contain}`;

  return (
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">` +
    `<style>${fontCss}${css}</style></head><body>` +
    `<main class="slide meme"><img class="art" src="${args.artDataUrl}" alt="">` +
    `<section class="content top"><p data-fit="title">${top}</p></section>` +
    (bottom ? `<section class="content bottom"><p data-fit="body">${bottom}</p></section>` : "") +
    brand +
    `</main></body></html>`
  );
}
