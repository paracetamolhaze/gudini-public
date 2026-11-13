# Астра: монтаж как у сильного креатора

Образец v2 — ролики креаторов про технологии, которые владелец любит больше всего. Автор говорит снизу во всю ширину, а над ним всё время живёт экран: в чат печатается вопрос и курсор жмёт «отправить», щёлкает переключатель, выскакивает ошибка, камера едет по настоящей странице GitHub к нужной строке, и её обводит жёлтый маркер. Истории из прошлого собраны из вырезанных архивных фото, как в документалках Vox. В конце ролика — одна и та же карточка с персонажем канала. Зритель видит не схему про вещь, а саму вещь: настоящую страницу, настоящий экран приложения, настоящее лицо.

Всё из основного учебника остаётся: слово за спиной автора, настоящие кадры, логотипы, панчи камеры, субтитры по слову. Ниже — то, что добавляет v2.

## Что показать

| Автор говорит о… | На экране |
|---|---|
| сайте, репозитории, новости, посте на форуме, статье Википедии, транзакции в блокчейне | `Screen` — настоящая страница: окно браузера въезжает, камера летит к фразе, маркер и кольцо |
| действии в приложении или на бирже: открыл, ввёл, нажал «отправить», включил защиту, подключил кошелёк | `Graphic` с живым интерфейсом: курсор кликает, текст печатается, переключатель щёлкает |
| ошибке, предупреждении, блокировке, «вы упёрлись в лимит», «перевод отправлен» | `Graphic` со всплывашкой `ui-toast` |
| человеке, месте, вещи из истории: Сатоши, Ласло и его пиццы, FTX, Mt. Gox | `Collage` — вырезанные настоящие фото на бумаге |
| том, как вещь устроена внутри: блок и цепочка, кошелёк и ключ, резерв стейблкоина, хранилище биржи | `Graphic` с разобранным механизмом — предмет раскрывается и показывает, что внутри (рецепт ниже) |
| том, кто кого обогнал: монеты по капитализации, биржи по объёму | `Graphic` с гонкой столбцов (рецепт ниже) |
| том, сколько стало из вложенного или сколько потеряно | `Graphic` с денежным счётчиком (рецепт ниже) |
| финальной просьбе: подписаться, написать в комментариях | `Outro` — карточка с персонажем канала |

## Стиль ролика: cream или night

В v2 у ролика одна из двух мягких палитр — так все ролики канала выглядят как один канал:

- `palette="cream"` — тёплый кремовый лист, белые карточки с мягкой тенью, оранжевый акцент. Объяснения, приложения, первые шаги, инструменты.
- `palette="night"` — почти чёрный с мягким светом сверху и тем же оранжевым. Мошенники, риски, ночь, большие суммы.

У обеих нет сетки, свет падает сверху, окно автора под графикой скруглено. Свой фон досок у них уже есть, `backdrop` им не нужен. `accent="scene"` по-прежнему делает акцент цветом комнаты автора.

## Screen — настоящая страница

```tsx
<Screen from={14.2} to={18.9} url="https://bitcointalk.org/index.php?topic=137.0" find="Pizza for bitcoins?" at={16.1} />
```

- `url` — адрес страницы, которая точно существует. Проверено, что открываются и снимаются чисто: en.wikipedia.org и ru.wikipedia.org (статьи), github.com (репозитории), bitcointalk.org (темы форума), mempool.space (блоки и транзакции биткоина), bitnodes.io (сколько узлов держат биткоин — «Reachable nodes»), coingecko.com и coinmarketcap.com (страницы монет), etherscan.io, tonviewer.com, t.me (публичные каналы), rbc.ru и coindesk.com (новости), сайты самих проектов. Binance и похожие биржи часто закрыты проверкой на робота.
- `find` — короткая фраза с этой страницы слово в слово, 2–6 слов: заголовок, имя, сумма, дата. `at` — слово автора, на котором он её называет. Сначала зритель видит верх страницы, к `at` камера подлетает к фразе, маркер проходит по ней, кольцо обводит.
- Доска держится 3.5–6 секунд, фраза отмечается не позже чем за 1.2 с до конца. За ролик 1–2 страницы — это доказательство «вот, смотри сам».
- Страницу открывает настоящий браузер. Если сайт закрыт проверкой на робота или фразы на странице нет, задача вернётся с причиной: возьми другой адрес той же вещи или другую фразу.

## Живой интерфейс в Graphic

В графику встроен набор частей интерфейса. Из них собирается экран, которым пользуются на глазах у зрителя. Хороший экран — одна крупная вещь в центре (окно, телефон, строка ввода) и одно действие на каждое слово автора. Части уже окрашены в палитру ролика.

- Окно сайта или программы: `<div class="ui-window"><div class="ui-bar"><span class="ui-url">app.uniswap.org</span></div><div class="ui-body">…</div></div>`.
- Телефон с приложением: `<div class="ui-phone"><div class="ui-screen"><div class="ui-app"><span class="ui-avatar"><i class="ui-i i-wallet"></i></span>Кошелёк</div>…</div></div>`; сообщения внутри — `<div class="ui-msg">…</div>` и `<div class="ui-msg out">…</div>`.
- Строка ввода: `<div class="ui-input"><span class="ui-text q"></span><i class="ui-caret"></i><span class="ui-send"></span></div>`. Текст печатается движением `{ at, sel: ".q", to: { text: "как купить биткоин?" }, dur: 1.2, ease: "none", sfx: "typing" }`.
- Курсор с кликом: `<div class="ui-cursor" style="left:560px;top:500px"><i class="ui-click"></i></div>` — кончик стрелки в точке left/top, ставь его на кнопку. Подлёт `{ at, sel: ".ui-cursor", from: { x: 260, y: 160, opacity: 0 }, dur: 0.6, ease: "power2.out" }`, нажатие `{ at: t, sel: ".ui-cursor", to: { scale: 0.85 }, dur: 0.08, sfx: "click" }` и `{ at: t + 0.1, sel: ".ui-cursor", to: { scale: 1 }, dur: 0.15 }`, круг от клика `{ at: t, sel: ".ui-click", from: { scale: 0.2, opacity: 1 }, to: { scale: 1.6, opacity: 0 }, dur: 0.5 }`.
- Кнопка: `<div class="ui-btn">Отправить</div>`, ещё `ui-btn ghost` и `ui-btn bad`. Нажатие — `to: { scale: 0.96 }` и обратно.
- Переключатель: `<div class="ui-setting">Двухфакторная защита<div class="ui-toggle tg"><i class="ui-knob kn"></i></div></div>`. Включение — `{ sel: ".kn", to: { x: 60 }, dur: 0.25, sfx: "click" }` и `{ sel: ".tg", to: { backgroundColor: "#1FA36A" }, dur: 0.25 }`.
- Всплывашка: `<div class="ui-toast bad">Вход с нового устройства<small>Москва, 03:12</small></div>`; `ui-toast good` — получилось, `ui-toast info` — к сведению. Выезжает `from: { y: 60, opacity: 0 }, ease: "back.out(1.6)", sfx: "notification"` (у ошибки `sfx: "error"`).
- Терминал: `<div class="ui-terminal"><div class="ui-line"><span class="ui-prompt">$</span> claude</div><div class="ui-line ui-ok">готово</div></div>`.
- Маркер по словам: `<span class="ui-mark mk">никому не показывай</span>`, проводится `{ sel: ".mk", to: { backgroundSize: "100% 100%" }, dur: 0.45 }`.
- Кольцо фокуса: `<div class="ui-ring" style="left:600px;top:120px;width:300px;height:120px"></div>`, рисуется `from: { scale: 1.6, opacity: 0 }`.
- Галочка в списке: `<div class="ui-row"><span class="ui-box"><i class="ui-tick t1"></i></span>Фраза записана на бумаге</div>`, ставится `{ sel: ".t1", from: { scale: 0 }, ease: "back.out(2)", sfx: "pop" }`.
- Полоса загрузки: `<div class="ui-track"><i class="ui-fill f"></i></div>`, заполняется `from: { scaleX: 0 }`.
- Метки и числа: `ui-chip` (`accent`, `good`, `bad`), `ui-big` — огромное число, `ui-label` — подпись под ним.
- Значок: `<i class="ui-i i-wallet"></i>` — любое имя из списка значков, цвет берёт у текста.
- Персонаж канала: `<div class="ui-mascot think"></div>`, позы `hi`, `point`, `think`, `shock`, `happy`, `sad`, `key`, `phone`. Он появляется рядом с интерфейсом 1–2 раза за ролик и реагирует на то, что происходит: думает над вопросом, пугается ошибки, радуется, что получилось.

Камера внутри графики: оберни всё в свой `<div class="cam">` и двигай его — `{ at, sel: ".cam", to: { scale: 1.15, x: -120, y: 40 }, dur: 0.9, ease: "power2.inOut" }`. Так камера подлетает к кнопке, как у креаторов.

У каждого движения может быть свой звук `sfx`: `click` на нажатии, `typing` пока печатается текст, `pop`, `notification`, `error`, `cash`, `whoosh`.

### Образец: отправка биткоина

```tsx
<Graphic from={12.2} to={16.6}
  html={`<div class="cam">
  <div class="ui-phone"><div class="ui-screen">
    <div class="ui-app"><span class="ui-avatar"><i class="ui-i i-wallet"></i></span>Кошелёк</div>
    <div class="ui-label">Сумма</div>
    <div class="amt">0</div>
    <div class="ui-chip">bc1q 7x9f ... 2kd8</div>
    <div class="ui-btn send">Отправить</div>
  </div></div>
  <div class="ui-cursor" style="left:560px;top:500px"><i class="ui-click"></i></div>
  <div class="ui-toast good note">Перевод отправлен<small>0.01 BTC, ждём подтверждения</small></div>
</div>`}
  css={`.cam{position:relative;width:984px;height:638px;display:flex;align-items:center;justify-content:center}
.amt{font:700 64px var(--display)} .send{margin-top:auto} .note{position:absolute;right:16px;top:70px;width:440px}`}
  motion={[
    { at: 12.3, sel: ".ui-phone", from: { y: 80, opacity: 0 }, dur: 0.5 },
    { at: 12.9, sel: ".amt", count: { from: 0, to: 0.01, decimals: 2, suffix: " BTC" }, dur: 0.8 },
    { at: 13.6, sel: ".ui-cursor", from: { x: 260, y: 160, opacity: 0 }, dur: 0.6, ease: "power2.out" },
    { at: 14.3, sel: ".ui-cursor", to: { scale: 0.85 }, dur: 0.08, sfx: "click" },
    { at: 14.4, sel: ".ui-cursor", to: { scale: 1 }, dur: 0.15 },
    { at: 14.3, sel: ".ui-click", from: { scale: 0.2, opacity: 1 }, to: { scale: 1.6, opacity: 0 }, dur: 0.5 },
    { at: 14.8, sel: ".note", from: { x: 120, opacity: 0 }, dur: 0.45, ease: "back.out(1.6)", sfx: "notification" },
    { at: 15.3, sel: ".cam", to: { scale: 1.1 }, dur: 1.0, ease: "power2.inOut" },
  ]} />
```

Каждое действие стоит на слове автора: «вводишь сумму» — число крутится, «жмёшь отправить» — курсор нажимает, «и всё, ушло» — всплывает уведомление.

## Привычные доски в v2

В v2 понятие показывается так, как зритель встретит его в жизни: экраном, которым он будет пользоваться, или настоящей страницей. Вот тот же ролик «Биткоин за минуту» в v2:

| Место ролика | В v2 |
|---|---|
| общая тетрадь переводов, копии у всех, подделку не примут | Graphic: окно «общая тетрадь», строки переводов появляются на словах, над окном — аватарки и «+18 000 копий», поддельная строка красная и гаснет, всплывает «Запись не принята» |
| адрес кошелька | Graphic: телефон с экраном «Получить» — QR, адрес печатается, курсор жмёт «Копировать», всплывает «Адрес скопирован» |
| 12 слов, сид-фраза | Graphic: телефон «Секретная фраза» — 12 слов выходят по одному, маркер на «запиши на бумаге», всплывает «Потерял — не восстановить», персонаж в шоке |
| Сатоши, 2009 | Collage с бюстом Сатоши в Будапеште (настоящих фото нет — его знают по бюсту) и плашкой |
| тысячи копий по всему миру | Screen: https://bitnodes.io/ с фразой «Reachable nodes» — настоящее число узлов |
| 21 миллион | слово за спиной со счётчиком или Graphic с `ui-big` и полосой `ui-track` |

Весь ролик в таком виде — в образце v2 «Биткоин за минуту», историю — в образце v2 про выброшенный диск.

Стрелки и редкие знаки рисуются значками (`<i class="ui-i i-arrow-right"></i>`): в шрифтах видео есть только ↑ и ↓.

## Рецепты графики

Три готовых графики, каждая отрисована и проверена. Бери рецепт целиком, меняй слова, числа и секунды под речь автора: каждое движение встаёт на своё слово.

### Разобранный механизм — как это устроено внутри

Когда автор объясняет устройство вещи (блок и цепочка, кошелёк и ключ, биржа и её хранилище, стейблкоин и резерв), зритель понимает быстрее всего, если видит настоящий предмет, который раскрывается у него на глазах: ящик поднимает крышку, внутрь ложатся монеты, крышка закрывается пломбой. Предмет и есть объяснение: блок — запечатанный ящик с переводами, цепочка — стопка таких ящиков, резерв — сейф под стопкой жетонов, ключ — замок с двенадцатью дисками.

Предмет собирается в изометрии из готовых деталей:

- Сцена: `<div class="ui-iso" style="--size:340">…</div>` — пол 340×340, на нём стоят детали. Ось x уходит вправо-вниз, y — влево-вниз, z — вверх.
- Ящик или плита: `<div class="iso-box" style="--x:70;--y:70;--w:200;--d:200;--h:54"></div>` — место на полу, ширина, глубина, высота; `--z` поднимает над полом. Три грани затенены сами. Цвета: без класса — светлый корпус, `dim` — приглушённый (то, что уже было), `accent` — главная деталь, о которой говорит автор (одна на предмет), `good`, `bad`, `floor` — пол под предметом. Внутрь ящика можно положить значок: `<i class="ui-i i-lock"></i>` ляжет на крышку.
- Монета или жетон: `<div class="iso-disc" style="--x:90;--y:90;--r:28;--z:44"></div>` — `--z` равен высоте того, на чём она лежит.
- Узел: `<div class="iso-group b3" style="--z:108">…детали…</div>` — детали, которые двигаются вместе (ящик со своим содержимым и крышкой). Места деталей внутри узла считаются от узла.
- Подпись: `<div class="iso-tag" style="left:560px;top:190px">новый блок</div>` — стоит рядом со сценой, с короткой выноской; 2–3 подписи по одному-два слова, каждая выходит на своём слове автора.

Детали двигаются вверх и вниз: `to: { z: "+=110" }` поднимает, `"-=110"` опускает; деталь, которая прилетает позже, приходит сверху с `from: { z: "+=260", opacity: 0 }`. Хороший предмет — 5–12 деталей, одна главная в цвете акцента, и история в три хода: собрался, раскрылся и показал, что внутри, закрылся. Держится 6–9 секунд — это главное событие ролика, одно на ролик.

```tsx
<Graphic from={0.2} to={7.8}
  html={`<div class="cam">
  <div class="ui-iso" style="--size:340">
<div class="iso-box floor" style="--x:-30;--y:-30;--w:400;--d:400"></div>
<div class="iso-group b1"><div class="iso-box dim" style="--x:70;--y:70;--w:200;--d:200;--h:54"></div></div>
<div class="iso-group b2" style="--z:54"><div class="iso-box dim" style="--x:70;--y:70;--w:200;--d:200;--h:54"></div></div>
<div class="iso-group b3" style="--z:108">
  <div class="iso-box" style="--x:70;--y:70;--w:200;--d:200;--h:44"></div>
  <div class="iso-disc c1" style="--x:90;--y:90;--r:28;--z:44"></div>
  <div class="iso-disc c2" style="--x:170;--y:105;--r:28;--z:44"></div>
  <div class="iso-disc c3" style="--x:120;--y:180;--r:28;--z:44"></div>
  <div class="iso-group lid" style="--z:58"><div class="iso-box accent" style="--x:64;--y:64;--w:212;--d:212;--h:16"><i class="ui-i i-lock"></i></div></div>
</div>
  </div>
  <div class="iso-tag t1" style="left:560px;top:190px">новый блок</div>
  <div class="iso-tag t2" style="left:560px;top:300px">переводы внутри</div>
  <div class="iso-tag t3" style="left:560px;top:450px">прошлые блоки</div>
</div>`}
  css={`.cam{position:relative;width:984px;height:638px;display:flex;align-items:center;justify-content:flex-start;padding-left:110px;padding-top:230px}`}
  motion={[
    { at: 0.3, sel: ".b1", from: { z: "+=420" }, dur: 0.4, ease: "power3.out", sfx: "pop" },
    { at: 0.6, sel: ".b2", from: { z: "+=420" }, dur: 0.4, ease: "power3.out", sfx: "pop" },
    { at: 0.9, sel: ".b3", from: { z: "+=420" }, dur: 0.4, ease: "power3.out", sfx: "pop" },
    { at: 2.0, sel: ".b3", to: { z: "+=70" }, dur: 0.5, ease: "power2.out" },
    { at: 2.0, sel: ".b2", to: { z: "+=25" }, dur: 0.5, ease: "power2.out" },
    { at: 2.3, sel: ".lid", to: { z: "+=110" }, dur: 0.5, ease: "power2.out", sfx: "whoosh" },
    { at: 2.5, sel: ".t1", from: { x: 40, opacity: 0 }, dur: 0.35 },
    { at: 3.2, sel: ".c1,.c2,.c3", from: { z: "+=260", opacity: 0 }, dur: 0.35, ease: "power2.in", stagger: 0.18, sfx: "cash" },
    { at: 3.4, sel: ".t2", from: { x: 40, opacity: 0 }, dur: 0.35 },
    { at: 4.6, sel: ".t3", from: { x: 40, opacity: 0 }, dur: 0.35 },
    { at: 5.4, sel: ".lid", to: { z: "-=110" }, dur: 0.3, ease: "power2.in", sfx: "click" },
    { at: 5.8, sel: ".b3", to: { z: "-=70" }, dur: 0.35, ease: "power2.in" },
    { at: 5.8, sel: ".b2", to: { z: "-=25" }, dur: 0.35, ease: "power2.in" },
    { at: 6.2, sel: ".cam", to: { scale: 1.06 }, dur: 1.5, ease: "power1.out" },
  ]} />
```

Рецепт о предмете-объяснении — по мотивам Anatomy (the object is the explanation), MIT, и блока exploded-stack из каталога HyperFrames, Apache-2.0.

### Гонка столбцов — кто кого обогнал

Сравнение нескольких монет, бирж или стран, где важно, что порядок меняется: столбцы растут вместе с числами, обогнавший меняется местами с соседом. Лидер в цвете акцента, обогнавший зеленеет на своём слове.

```tsx
<Graphic from={0.2} to={5.8}
  html={`<div class="race">
  <div class="ui-label">Капитализация, млрд $</div>
  <div class="row r1"><span class="name">Bitcoin</span><i class="bar b1"></i><b class="v1">0</b></div>
  <div class="row r2"><span class="name">Ethereum</span><i class="bar b2"></i><b class="v2">0</b></div>
  <div class="row r3"><span class="name">Dogecoin</span><i class="bar b3"></i><b class="v3">0</b></div>
  <div class="row r4"><span class="name">Solana</span><i class="bar b4"></i><b class="v4">0</b></div>
</div>`}
  css={`.race{position:relative;width:900px;height:520px}
.row{position:absolute;left:0;top:70px;width:900px;height:92px;display:flex;align-items:center;gap:20px;font:700 34px var(--sans)}
.r2{top:176px}.r3{top:282px}.r4{top:388px}
.name{width:210px;text-align:right;color:var(--muted)}
.bar{display:block;height:64px;width:560px;border-radius:14px;background:var(--faint);transform-origin:0 50%}
.b1{background:var(--accent)}
.row b{font:700 40px var(--display);margin-left:-560px;padding-left:16px;transform:translateX(calc(var(--k,1)*560px))}`}
  motion={[
    { at: 0.3, sel: ".row", from: { x: -60, opacity: 0 }, dur: 0.35, stagger: 0.07 },
    { at: 0.5, sel: ".b1", from: { scaleX: 0.02 }, to: { scaleX: 1 }, dur: 1.4, ease: "power2.out" },
    { at: 0.5, sel: ".b2", from: { scaleX: 0.02 }, to: { scaleX: 0.3 }, dur: 1.4, ease: "power2.out" },
    { at: 0.5, sel: ".b3", from: { scaleX: 0.02 }, to: { scaleX: 0.09 }, dur: 1.4, ease: "power2.out" },
    { at: 0.5, sel: ".b4", from: { scaleX: 0.02 }, to: { scaleX: 0.06 }, dur: 1.4, ease: "power2.out" },
    { at: 0.5, sel: ".v1", count: { from: 0, to: 1300 }, dur: 1.4 }, { at: 0.5, sel: ".v1", from: { x: 12 }, to: { x: 560 }, dur: 1.4, ease: "power2.out" },
    { at: 0.5, sel: ".v2", count: { from: 0, to: 390 }, dur: 1.4 }, { at: 0.5, sel: ".v2", from: { x: 12 }, to: { x: 168 }, dur: 1.4, ease: "power2.out" },
    { at: 0.5, sel: ".v3", count: { from: 0, to: 117 }, dur: 1.4 }, { at: 0.5, sel: ".v3", from: { x: 12 }, to: { x: 50 }, dur: 1.4, ease: "power2.out" },
    { at: 0.5, sel: ".v4", count: { from: 0, to: 78 }, dur: 1.4 }, { at: 0.5, sel: ".v4", from: { x: 12 }, to: { x: 34 }, dur: 1.4, ease: "power2.out" },
    { at: 3.0, sel: ".b4", to: { scaleX: 0.22, backgroundColor: "#1FA36A" }, dur: 0.9, ease: "power2.inOut", sfx: "whoosh" },
    { at: 3.0, sel: ".v4", count: { from: 78, to: 286 }, dur: 0.9 }, { at: 3.0, sel: ".v4", to: { x: 123 }, dur: 0.9, ease: "power2.inOut" },
    { at: 3.5, sel: ".r4", to: { y: -106 }, dur: 0.45, ease: "power2.inOut" },
    { at: 3.5, sel: ".r3", to: { y: 106 }, dur: 0.45, ease: "power2.inOut" },
  ]} />
```

Ширина столбца — доля от лидера (`scaleX` от 0 до 1 при полной ширине 560), число едет у конца столбца (`x` = доля × 560). Строки стоят через 106 px — на столько же сдвигаются при обгоне.

### Денежный счётчик — сколько стало

Итог вложения или потери: число крупно растёт от вложенной суммы до итога и на последнем слове меняет цвет, из-за него вылетают купюры. Рост идёт с разгоном (`ease: "power2.in"`): последние цифры пролетают быстрее всего, и остановка звучит как удар.

```tsx
<Graphic from={6.0} to={10.8}
  html={`<div class="money"><div class="ui-label">Вложил 100 $ в 2015-м</div><div class="ui-big sum">0</div>
  <div class="ui-chip good tag">+ 43 900 %</div>
  <i class="bill n1"></i><i class="bill n2"></i><i class="bill n3"></i><i class="bill n4"></i><i class="bill n5"></i><i class="bill n6"></i></div>`}
  css={`.money{position:relative;width:900px;height:520px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
.tag{height:70px;font-size:34px}
.bill{position:absolute;left:50%;top:50%;width:92px;height:50px;margin:-25px 0 0 -46px;border-radius:8px;background:#1FA36A;box-shadow:0 0 0 3px #fff inset,0 0 0 5px #1FA36A inset;opacity:0}`}
  motion={[
    { at: 6.1, sel: ".sum", from: { scale: 1.5, opacity: 0 }, dur: 0.35 },
    { at: 6.3, sel: ".sum", count: { from: 100, to: 44000, suffix: " $" }, dur: 2.0, ease: "power2.in" },
    { at: 8.3, sel: ".sum", to: { color: "#1FA36A", scale: 1.08 }, dur: 0.15, sfx: "cash" },
    { at: 8.45, sel: ".sum", to: { scale: 1 }, dur: 0.3, ease: "power2.out" },
    { at: 8.3, sel: ".n1", to: { x: -360, y: -190, rotation: -24, opacity: 1 }, dur: 0.55, ease: "power3.out" },
    { at: 8.3, sel: ".n2", to: { x: 350, y: -200, rotation: 18, opacity: 1 }, dur: 0.55, ease: "power3.out" },
    { at: 8.3, sel: ".n3", to: { x: -390, y: 60, rotation: 12, opacity: 1 }, dur: 0.55, ease: "power3.out" },
    { at: 8.3, sel: ".n4", to: { x: 390, y: 40, rotation: -14, opacity: 1 }, dur: 0.55, ease: "power3.out" },
    { at: 8.3, sel: ".n5", to: { x: -250, y: 210, rotation: -8, opacity: 1 }, dur: 0.55, ease: "power3.out" },
    { at: 8.3, sel: ".n6", to: { x: 260, y: 215, rotation: 22, opacity: 1 }, dur: 0.55, ease: "power3.out" },
    { at: 8.7, sel: ".tag", from: { y: 40, opacity: 0 }, dur: 0.35, ease: "back.out(1.6)", sfx: "pop" },
    { at: 8.9, sel: ".bill", to: { y: "+=26" }, dur: 1.8, ease: "none" },
  ]} />
```

Для потери итог красный (`#E5484D`), купюры падают вниз (`y` от 200 до 320), плашка `ui-chip bad`.

Рецепты гонки и счётчика — по мотивам блоков bar-chart-race и apple-money-count из каталога HyperFrames, Apache-2.0.

## Collage — история на бумаге

```tsx
<Collage from={20.4} to={26.8} title="Биткоин-пицца" titleAt={20.6}
  items={[
    { query: "Laszlo Hanyecz", wiki: "Laszlo Hanyecz", at: 21.0, label: "Ласло" },
    { query: "pepperoni pizza", at: 23.2, label: "2 пиццы", color: true },
  ]} />
```

- Для историй о настоящих людях, местах и вещах. Их настоящие фото из Википедии и Wikimedia Commons вырезаются по контуру с белой бумажной каймой и кладутся на бумагу перед цветным кругом.
- 1–3 куска, каждый ложится на своём слове (`at`). Первый — главный и крупнее остальных.
- `query` — английские слова для поиска фото, `wiki` — статья Википедии, если она есть.
- `label` — одно-два слова на рваной полоске: имя, место, год. `title` — плашка над историей, `titleAt` — когда её приклеить.
- `color: true` оставляет вещи её цвета (пицца, красная машина). Люди и архив остаются чёрно-белыми, как вырезки из газеты. `color` у самого коллажа — цвет круга, оранжевый по умолчанию.
- Держится 3.5–7 секунд. Хорошо открывает историю и встаёт на её поворотах.
- Каждую вырезку Астра проверяет глазами: если нашлось не то фото, задача вернётся — дай другие слова поиска.

## Outro — одна концовка на все ролики

```tsx
<Outro from={57.1} to={59.23} title="ПОДПИШИСЬ" text="дальше — как не потерять ключ" />
```

Последние секунды ролика, пока автор произносит финальную просьбу (подпишись, напиши в комментариях), от 1.5 до 7 секунд. Если просьба — последние слова ролика, концовка держится до конца (`to` — длительность ролика). Если после неё автор задаёт вопрос, вопрос идёт выбором на экране (Compare с заголовком-вопросом) после концовки и держится до последнего кадра. Персонаж канала выпрыгивает и машет, крупно одна просьба, ниже — что будет в следующем ролике или вопрос зрителю, словами самого автора (до 48 знаков). Поза `hi` (по умолчанию) или `happy`: кнопка подписки на каждой площадке в своём месте, поэтому персонаж ни на что не показывает.

## Ритм ролика v2 на 60 секунд

- 0–3 с — крючок: главное число или имя за спиной автора, настоящая страница или живой экран с первым действием.
- Дальше каждые 2–4 секунды — новое событие на своём слове. Живой экран (Graphic с интерфейсом) и настоящая страница (Screen) — главные доски v2, 3–5 за ролик. Между ними — слово за спиной, логотип, настоящие кадры.
- История — коллажем, один-два раза.
- Финал — `Outro` на просьбе автора.
