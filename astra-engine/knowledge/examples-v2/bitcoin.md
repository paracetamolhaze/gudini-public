# Образец v2: объяснение (59 секунд, настоящий ролик владельца)

Тема: «Биткоин за минуту: объясняю так, чтобы понял младший брат».
Цвет кадра автора: #51CD82 — комната подсвечена зелёным.

## Расшифровка

`индекс:слово@начало`

0:Представь@0.15 1:деньги,@1.13 2:у@1.37 3:которых@1.43 4:нет@1.79 5:банка,@2.05 6:нет@2.73 7:директора,@2.97 8:нет@3.53 9:кнопки@3.73 10:"отменить@3.99 11:перевод".@4.37 12:Это@5.03 13:Bitcoin.@5.23 14:Смотри@5.98 15:Есть@6.36 16:общий@6.56 17:чат,@6.84 18:и@7.38 19:в@7.44 20:нём@7.50 21:одна@7.66 22:тетрадь@7.88 23:на@8.22 24:всех.@8.32 25:Каждый@9.00 26:перевод@9.36 27:-@10.02 28:новая@10.10 29:строчка:@10.44 30:кто,@10.92 31:кому@11.24 32:и@11.50 33:сколько.@11.60 34:Копия@12.30 35:тетради@12.58 36:лежит@12.96 37:у@13.22 38:тысяч@13.32 39:людей@13.64 40:по@13.94 41:всему@14.02 42:миру,@14.28 43:Поэтому@14.98 44:подделать@15.44 45:нельзя.@16.20 46:Если@16.98 47:ты@17.14 48:впишешь@17.24 49:себе@17.56 50:лишний@17.74 51:ноль,@18.08 52:в@18.44 53:остальных@18.50 54:копиях@18.98 55:этого@19.52 56:нет.@19.84 57:Твою@20.36 58:правку@20.62 59:просто@21.20 60:не@21.58 61:примут.@21.74 62:Имён@22.42 63:в@22.66 64:тетради@22.74 65:нет.@23.20 66:Есть@23.76 67:адрес,@24.06 68:как@24.38 69:ник,@24.58 70:и@25.12 71:ключ@25.26 72:к@25.54 73:нему@25.62 74:как@25.90 75:пароль.@26.10 76:Только@26.80 77:пароль@27.04 78:тут@27.28 79:восстановить@27.42 80:некому.@27.96 81:Если@28.50 82:ты@28.66 83:Потерял@28.76 84:ключ,@29.12 85:монеты@29.38 86:остались@29.68 87:в@30.02 88:тетради@30.06 89:иии@30.85 90:их@31.33 91:никто@31.45 92:не@31.69 93:сможет@31.83 94:открыть.@32.11 95:Bitcoin@33.01 96:запустили@33.37 97:в@33.77 98:2009@33.85 99:году.@34.43 100:Автор@35.05 101:скрылся@35.31 102:под@35.71 103:ником@35.89 104:Сатоши@36.39 105:Накамото@36.73 106:и@37.55 107:его@37.61 108:до@37.75 109:сих@37.87 110:пор@38.07 111:никто@38.23 112:не@38.49 113:нашел.@38.59 114:И@39.35 115:главное@39.45 116:-@40.25 117:биткоинов@40.29 118:будет@40.87 119:максимум@41.29 120:21@42.09 121:миллион.@42.51 122:Напечатать@43.17 123:больше@44.07 124:просто@44.61 125:физически@45.29 126:невозможно.@45.81 127:Это@46.75 128:записано@46.91 129:в@47.37 130:правилах,@47.47 131:и@48.21 132:их@48.31 133:держат@48.45 134:все@49.05 135:те@49.35 136:же@49.55 137:тысячи@49.87 138:копий.@50.59 139:Обычные@51.15 140:деньги@51.55 141:печатает@51.79 142:банк.@52.25 143:Bitcoin@52.93 144:ведет@53.31 145:тетрадь,@53.63 146:которую@54.21 147:нельзя@54.57 148:переписать.@54.95 149:Подпишись@55.70 150:В@56.32 151:следующем@56.36 152:ролике@56.70 153:расскажу@57.00 154:про@57.38 155:самый@57.62 156:дорогой@57.90 157:ужин@58.26 158:в@58.44 159:истории.@58.48

## Монтаж

```tsx
import React from "react";
import { AstraVideo, BehindText, cam, Captions, Collage, Compare, Graphic, Music, Outro, Screen } from "../kit";

export const Montage: React.FC = () => (
  <AstraVideo
    palette="cream"
    accent="scene"
    camera={[
      cam.push(0, 1.0, 1.08),
      cam.reset(4.9),
      cam.punch(5.23, 1.18),       // «Это Bitcoin» — ближе, имя за спиной
      cam.reset(7.6),
      cam.punch(15.44, 1.2),       // «подделать нельзя»
      cam.reset(16.9),
      cam.punch(33.85, 1.16),      // «в 2009 году» — год за спиной
      cam.reset(36.3),
      cam.punch(39.45, 1.18),      // «И главное»
      cam.reset(40.3),
    ]}
  >
    {/* Крючок — экран, который знает каждый: перевод в банке. «Нет банка, нет директора» вычёркиваются, курсор жмёт «Отменить» — а такой кнопки нет */}
    <Graphic from={1.0} to={4.9}
      html={`<div class="cam">
  <div class="cut"><span class="ui-chip x c1">банк</span><span class="ui-chip x c2">директор</span></div>
  <div class="ui-phone"><div class="ui-screen">
    <div class="ui-app"><span class="ui-avatar"><i class="ui-i i-bank"></i></span>Банк</div>
    <div class="ui-label">Перевод отправлен</div>
    <div class="sum">5 000 руб.</div>
    <div class="ui-btn ghost undo">Отменить перевод</div>
  </div></div>
  <div class="ui-cursor" style="left:560px;top:555px"><i class="ui-click"></i></div>
  <div class="ui-toast bad no">В биткоине такой кнопки нет</div>
</div>`}
      css={`.cam{position:relative;width:984px;height:638px;display:flex;align-items:center;justify-content:center}
.cut{position:absolute;left:30px;top:110px;display:flex;flex-direction:column;gap:16px}
.x{font-size:34px;height:66px;text-decoration:line-through;text-decoration-thickness:4px;text-decoration-color:var(--bad)}
.sum{font:700 60px var(--display)}.undo{margin-top:auto;height:76px;padding:0 18px;font-size:27px}
.no{position:absolute;right:6px;top:70px;width:420px}`}
      motion={[
        { at: 1.05, sel: ".ui-phone", from: { y: 80, opacity: 0 }, dur: 0.5 },
        { at: 2.05, sel: ".c1", from: { x: -40, opacity: 0 }, dur: 0.35, ease: "back.out(1.7)", sfx: "pop" },
        { at: 2.97, sel: ".c2", from: { x: -40, opacity: 0 }, dur: 0.35, ease: "back.out(1.7)", sfx: "pop" },
        { at: 3.5, sel: ".ui-cursor", from: { x: 240, y: -140, opacity: 0 }, dur: 0.45, ease: "power2.out" },
        { at: 3.99, sel: ".ui-cursor", to: { scale: 0.85 }, dur: 0.08, sfx: "click" },
        { at: 4.09, sel: ".ui-cursor", to: { scale: 1 }, dur: 0.15 },
        { at: 3.99, sel: ".ui-click", from: { scale: 0.2, opacity: 1 }, to: { scale: 1.6, opacity: 0 }, dur: 0.5 },
        { at: 4.37, sel: ".undo", to: { opacity: 0.35 }, dur: 0.2 },
        { at: 4.37, sel: ".no", from: { x: 80, opacity: 0 }, dur: 0.4, ease: "back.out(1.6)", sfx: "error" },
      ]} />

    {/* Имя героя ролика — огромным словом за спиной, с ударом */}
    <BehindText from={5.0} to={6.5} text="BITCOIN" sfx="impact" />

    {/* «Одна тетрадь на всех» — общий документ: строки переводов пишутся на словах, над ним аватарки тех, у кого копия */}
    <Graphic from={7.6} to={14.9}
      html={`<div class="cam">
  <div class="ui-window doc"><div class="ui-bar"><span class="ui-url">общая тетрадь биткоина</span></div><div class="ui-body">
    <div class="ui-row r1"><span class="ui-avatar">А</span><span class="who">Аня <i class="ui-i i-arrow-right"></i> Макс</span><span class="ui-chip">0.05 BTC</span></div>
    <div class="ui-row r2"><span class="ui-avatar">М</span><span class="who">Макс <i class="ui-i i-arrow-right"></i> Лёша</span><span class="ui-chip">0.01 BTC</span></div>
    <div class="ui-row r3"><span class="ui-avatar">Л</span><span class="who">Лёша <i class="ui-i i-arrow-right"></i> Аня</span><span class="ui-chip">0.02 BTC</span></div>
  </div></div>
  <div class="peers"><span class="ui-avatar p">Д</span><span class="ui-avatar p">К</span><span class="ui-avatar p">О</span><span class="ui-avatar p">Ю</span><span class="ui-chip accent more">+10 000 копий</span></div>
</div>`}
      css={`.cam{position:relative;width:984px;height:638px;display:flex;align-items:center;justify-content:center}
.doc{width:820px;margin-top:60px}.who{flex:1}.peers{position:absolute;left:92px;top:14px;display:flex;align-items:center;gap:10px}.p{border:4px solid var(--bg)}`}
      motion={[
        { at: 7.7, sel: ".doc", from: { y: 60, opacity: 0 }, dur: 0.5 },
        { at: 10.44, sel: ".r1", from: { x: -40, opacity: 0 }, dur: 0.4, sfx: "pop" },
        { at: 10.92, sel: ".r2", from: { x: -40, opacity: 0 }, dur: 0.4, sfx: "pop" },
        { at: 11.6, sel: ".r3", from: { x: -40, opacity: 0 }, dur: 0.4, sfx: "pop" },
        { at: 12.3, sel: ".p", from: { scale: 0, opacity: 0 }, dur: 0.35, ease: "back.out(2)", stagger: 0.08 },
        { at: 13.32, sel: ".more", from: { x: -30, opacity: 0 }, dur: 0.4 },
      ]} />

    {/* «Впишешь себе лишний ноль» — своя строка красная; «в остальных копиях этого нет… не примут» — гаснет, всплывает отказ */}
    <Graphic from={16.9} to={22.3}
      html={`<div class="cam">
  <div class="ui-window doc"><div class="ui-bar"><span class="ui-url">твоя копия тетради</span></div><div class="ui-body">
    <div class="ui-row"><span class="ui-avatar">А</span><span class="who">Аня <i class="ui-i i-arrow-right"></i> Макс</span><span class="ui-chip">0.05 BTC</span></div>
    <div class="ui-row"><span class="ui-avatar">М</span><span class="who">Макс <i class="ui-i i-arrow-right"></i> Лёша</span><span class="ui-chip">0.01 BTC</span></div>
    <div class="ui-row fake"><span class="ui-avatar">Т</span><span class="who">Макс <i class="ui-i i-arrow-right"></i> Ты</span><span class="ui-chip bad">0.50 BTC</span></div>
  </div></div>
  <div class="ui-toast bad no">Правку не приняли<small>в остальных копиях её нет</small></div>
</div>`}
      css={`.cam{position:relative;width:984px;height:638px;display:flex;align-items:center;justify-content:center}
.doc{width:820px}.who{flex:1}.fake .who{color:var(--bad)}.no{position:absolute;right:20px;bottom:18px;width:560px}`}
      motion={[
        { at: 17.0, sel: ".doc", from: { y: 60, opacity: 0 }, dur: 0.5 },
        { at: 17.74, sel: ".fake", from: { x: -40, opacity: 0 }, dur: 0.4, sfx: "pop" },
        { at: 21.58, sel: ".fake", to: { opacity: 0.3 }, dur: 0.3 },
        { at: 21.58, sel: ".no", from: { y: 60, opacity: 0 }, dur: 0.4, ease: "back.out(1.6)", sfx: "error" },
      ]} />

    {/* «Есть адрес, как ник, и ключ как пароль» — экран «Получить» в кошельке: QR, адрес печатается, ключ — отдельной строкой */}
    <Graphic from={23.6} to={26.7}
      html={`<div class="cam">
  <div class="ui-phone"><div class="ui-screen">
    <div class="ui-app"><span class="ui-avatar"><i class="ui-i i-wallet"></i></span>Получить</div>
    <i class="ui-i i-qr qr"></i>
    <div class="ui-label">Мой адрес</div>
    <div class="addr"></div>
    <div class="ui-chip key"><i class="ui-i i-key-round"></i>ключ — пароль</div>
  </div></div>
</div>`}
      css={`.cam{position:relative;width:984px;height:638px;display:flex;align-items:center;justify-content:center}
.qr{font-size:170px;align-self:center;margin:6px 0}.addr{font:600 24px var(--mono);min-height:32px}.key{margin-top:auto;align-self:flex-start}`}
      motion={[
        { at: 23.7, sel: ".ui-phone", from: { y: 80, opacity: 0 }, dur: 0.5 },
        { at: 24.06, sel: ".addr", to: { text: "1A1z 7x9f ... DivfNa" }, dur: 0.7, ease: "none", sfx: "typing" },
        { at: 25.26, sel: ".key", from: { scale: 0.6, opacity: 0 }, dur: 0.35, ease: "back.out(2)", sfx: "pop" },
      ]} />

    {/* «Восстановить некому… потерял ключ» — экран секретной фразы: 12 слов, отказ и персонаж в шоке */}
    <Graphic from={26.7} to={32.4}
      html={`<div class="cam">
  <div class="ui-phone"><div class="ui-screen">
    <div class="ui-app"><span class="ui-avatar"><i class="ui-i i-key-round"></i></span>Ключ</div>
    <div class="ui-label tip">Запиши на <span class="ui-mark mk">бумаге</span></div>
    <div class="grid"><span class="w">1 ocean</span><span class="w">2 mirror</span><span class="w">3 velvet</span><span class="w">4 rocket</span><span class="w">5 anchor</span><span class="w">6 summer</span><span class="w">7 pencil</span><span class="w">8 orbit</span><span class="w">9 castle</span><span class="w">10 lemon</span><span class="w">11 puzzle</span><span class="w">12 canyon</span></div>
  </div></div>
  <div class="ui-toast bad lost">Восстановить некому<small>ни банк, ни поддержка не помогут</small></div>
  <div class="ui-mascot shock m"></div>
</div>`}
      css={`.cam{position:relative;width:984px;height:638px;display:flex;align-items:center;justify-content:center}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.w{padding:9px 10px;border-radius:14px;background:var(--surface);border:1.5px solid var(--line);font:600 19px var(--mono)}
.tip{font-size:26px}.lost{position:absolute;left:16px;bottom:30px;width:400px}.m{position:absolute;right:30px;bottom:10px;width:230px;height:230px}`}
      motion={[
        { at: 26.8, sel: ".ui-phone", from: { y: 80, opacity: 0 }, dur: 0.5 },
        { at: 27.04, sel: ".w", from: { scale: 0.6, opacity: 0 }, dur: 0.3, ease: "back.out(2)", stagger: 0.06, sfx: "pop" },
        { at: 27.96, sel: ".lost", from: { y: 60, opacity: 0 }, dur: 0.4, ease: "back.out(1.6)", sfx: "error" },
        { at: 28.76, sel: ".m", from: { scale: 0, opacity: 0 }, dur: 0.4, ease: "back.out(2)" },
        { at: 30.06, sel: ".mk", to: { backgroundSize: "100% 100%" }, dur: 0.45 },
      ]} />

    {/* Год — за спиной автора со звуком */}
    <BehindText from={33.75} to={35.0} text="2009" sfx="impact" />

    {/* Сатоши — бумажный коллаж с его бюстом в Будапеште: настоящих фото нет, его знают по бюсту */}
    <Collage from={36.3} to={39.4} title="Автор не найден" titleAt={38.23}
      items={[{ query: "Satoshi Nakamoto bust Budapest", at: 36.39, label: "Сатоши" }]} />

    {/* Предел: число крутится до 21 миллиона, полоса показывает, сколько уже добыто, «напечатать невозможно» — отказом */}
    <Graphic from={40.3} to={46.4}
      html={`<div class="lim">
  <div class="ui-big n">0</div>
  <div class="ui-label">биткоинов — и больше не будет</div>
  <div class="ui-track"><i class="ui-fill f"></i></div>
  <div class="ui-label">19.9 млн уже добыто</div>
  <div class="ui-toast bad no">Напечатать больше невозможно</div>
</div>`}
      css={`.lim{display:flex;flex-direction:column;align-items:center;gap:16px}.no{margin-top:10px}`}
      motion={[
        { at: 40.4, sel: ".lim", from: { y: 50, opacity: 0 }, dur: 0.5 },
        { at: 42.09, sel: ".n", count: { from: 0, to: 21000000 }, dur: 1.0, sfx: "cash" },
        { at: 43.17, sel: ".f", from: { scaleX: 0 }, to: { scaleX: 0.948 }, dur: 1.0, ease: "power2.out" },
        { at: 45.29, sel: ".no", from: { y: 40, opacity: 0 }, dur: 0.4, ease: "back.out(1.6)", sfx: "error" },
      ]} />

    {/* «Их держат тысячи копий» — настоящая страница: сколько узлов держат биткоин прямо сейчас */}
    <Screen from={46.6} to={51.0} url="https://bitnodes.io/" find="Reachable nodes" at={48.45} />

    {/* Вывод: две стороны, банк уходит в тень */}
    <Compare
      from={51.0}
      to={55.6}
      left={{ title: "Банк", icon: "bank", items: [{ text: "печатает деньги", at: 51.79 }] }}
      right={{ title: "Bitcoin", icon: "bitcoin", items: [{ text: "ведёт тетрадь", at: 53.31 }, { text: "её не переписать", at: 54.57 }] }}
    />

    {/* «Подпишись, в следующем ролике — самый дорогой ужин» — одна концовка канала */}
    <Outro from={55.9} to={59.9} title="ПОДПИШИСЬ" text="дальше — самый дорогой ужин в истории" />

    <Music mood="curious" />
    <Captions style="clean" emphasis={[5, 7, 13, 22, 38, 44, 51, 61, 67, 71, 83, 98, 104, 120, 125, 147]} />
  </AstraVideo>
);
```

## Почему так

- Каждое понятие — экран, который зритель встретит сам: банковский перевод без кнопки отмены, общий документ с копиями у всех, экран «Получить» в кошельке, экран секретной фразы. Действия стоят на словах: курсор жмёт «Отменить» на слове «отменить», отказ всплывает на «не примут».
- Настоящее вместо нарисованного: число узлов биткоина — живая страница bitnodes.io с отметкой, Сатоши — его бюст на бумажном коллаже.
- Палитра cream, акцент — зелёный из комнаты автора; персонаж канала пугается на «потерял ключ» и прощается в концовке.
- Короткие факты по-прежнему за спиной автора: «BITCOIN», «2009».
