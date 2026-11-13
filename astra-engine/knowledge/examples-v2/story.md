# Образец v2: история (26 секунд)

Тема: «Человек выбросил жёсткий диск с тысячами биткоинов».

## Расшифровка

0:В@0.10 1:2013@0.20 2:году@0.90 3:айтишник@1.20 4:из@1.80 5:Уэльса@1.92 6:выбросил@2.50 7:старый@3.00 8:жёсткий@3.36 9:диск.@3.76 10:Обычная@4.60 11:уборка.@5.10 12:Только@6.00 13:на@6.30 14:диске@6.42 15:лежал@6.86 16:ключ@7.20 17:от@7.50 18:восьми@7.62 19:тысяч@8.04 20:биткоинов.@8.36 21:Тогда@9.30 22:это@9.60 23:было@9.76 24:несколько@10.00 25:тысяч@10.46 26:долларов.@10.80 27:Сегодня@11.80 28:—@12.30 29:сотни@12.50 30:миллионов.@12.94 31:Он@14.00 32:предлагал@14.18 33:городу@14.72 34:раскопать@15.10 35:свалку@15.60 36:за@16.04 37:свой@16.20 38:счёт@16.46 39:—@16.90 40:ему@17.10 41:отказали.@17.30 42:Мораль@18.60 43:простая:@19.06 44:биткоин@19.90 45:не@20.40 46:на@20.52 47:диске,@20.64 48:а@21.20 49:в@21.30 50:ключе.@21.42 51:Нет@22.40 52:ключа@22.64 53:—@23.00 54:нет@23.20 55:денег.@23.46 56:Делай@24.30 57:резервные@24.66 58:копии.@25.20

## Монтаж

```tsx
import React from "react";
import { AstraVideo, BehindText, Captions, cam, Collage, Compare, Graphic, MapFocus, Music, Screen } from "../kit";

export const Montage: React.FC = () => (
  <AstraVideo
    palette="cream"
    camera={[
      cam.push(0, 1.9, 1.1),
      cam.reset(4.6),
      cam.punch(6.0, 1.2),        // «Только на диске…» — поворот
      cam.reset(9.2),
      cam.push(18.6, 19.8, 1.12), // «Мораль простая» — ближе
      cam.reset(19.8),
    ]}
  >
    {/* История: крючок — место, где всё случилось */}
    <MapFocus from={0.15} to={3.0} region="world" lat={51.59} lon={-2.99} label="Уэльс" highlight="United Kingdom" zoom={5} />
    {/* Вещь из истории — вырезанным фото на бумаге, с плашкой года */}
    <Collage from={3.1} to={6.2} title="Уборка 2013 года" titleAt={4.6}
      items={[{ query: "hard disk drive", at: 3.36, label: "Диск", color: true }]} />
    {/* Число — за спиной автора с ударом */}
    <BehindText from={7.55} to={9.2} text="8 000 BTC" sfx="impact" />
    {/* «Тогда… сегодня — сотни миллионов» — настоящая страница с ценой биткоина сегодня */}
    <Screen from={9.3} to={13.9} url="https://www.coingecko.com/en/coins/bitcoin" find="Bitcoin Price" at={11.8} />
    {/* «Предлагал городу раскопать свалку — ему отказали» — его письмо печатается, ответ приходит отказом */}
    <Graphic from={14.0} to={18.6}
      html={`<div class="cam">
  <div class="ui-window mail"><div class="ui-bar"><span class="ui-url">Письмо в городской совет</span></div><div class="ui-body">
    <div class="ui-label">Тема</div>
    <div class="subj"></div>
    <div class="ui-btn send">Отправить</div>
  </div></div>
  <div class="ui-toast bad no">Ответ совета: отказано<small>раскопки свалки запрещены</small></div>
</div>`}
      css={`.cam{position:relative;width:984px;height:638px;display:flex;align-items:center;justify-content:center}
.mail{width:820px}.subj{font:600 38px var(--sans);min-height:48px}.send{align-self:flex-end}
.no{position:absolute;right:16px;bottom:16px;width:560px}`}
      motion={[
        { at: 14.05, sel: ".mail", from: { y: 60, opacity: 0 }, dur: 0.5 },
        { at: 14.18, sel: ".subj", to: { text: "Раскопаю свалку за свой счёт" }, dur: 1.6, ease: "none", sfx: "typing" },
        { at: 16.46, sel: ".send", to: { scale: 0.94 }, dur: 0.1, sfx: "click" },
        { at: 16.56, sel: ".send", to: { scale: 1 }, dur: 0.15 },
        { at: 17.3, sel: ".no", from: { y: 60, opacity: 0 }, dur: 0.4, ease: "back.out(1.6)", sfx: "error" },
      ]} />
    {/* Мораль: «не на диске, а в ключе» — две стороны, диск уходит в тень */}
    <Compare
      from={19.8}
      to={23.6}
      left={{ title: "Диск", icon: "disk", items: [{ text: "просто железо", at: 20.52 }] }}
      right={{ title: "Ключ", icon: "key", items: [{ text: "в нём и есть биткоин", at: 21.3 }] }}
    />
    {/* «Делай резервные копии» — список, который зритель сделает сам: галочки ставятся на словах, персонаж с ключом */}
    <Graphic from={23.6} to={26.6}
      html={`<div class="cam">
  <div class="ui-card list">
    <div class="ui-row"><span class="ui-box"><i class="ui-tick t1"></i></span>Ключ записан на бумаге</div>
    <div class="ui-row"><span class="ui-box"><i class="ui-tick t2"></i></span>Вторая копия — в другом месте</div>
  </div>
  <div class="ui-mascot key m"></div>
</div>`}
      css={`.cam{position:relative;width:984px;height:638px;display:flex;align-items:center;justify-content:center;gap:20px}
.list{display:flex;flex-direction:column;gap:26px}.m{width:240px;height:240px}`}
      motion={[
        { at: 23.7, sel: ".list", from: { y: 50, opacity: 0 }, dur: 0.45 },
        { at: 23.8, sel: ".m", from: { scale: 0, opacity: 0 }, dur: 0.4, ease: "back.out(2)" },
        { at: 24.66, sel: ".t1", from: { scale: 0 }, dur: 0.35, ease: "back.out(2)", sfx: "pop" },
        { at: 25.2, sel: ".t2", from: { scale: 0 }, dur: 0.35, ease: "back.out(2)", sfx: "pop" },
      ]} />
    <Music mood="tense" />
    <Captions style="minimal" emphasis={[1, 16, 18, 19, 29, 30, 41, 50, 55]} />
  </AstraVideo>
);
```

## Почему так

- История из прошлого — бумажным коллажем: сам диск вырезан из фото, плашка «Уборка 2013 года» приклеивается на «обычная уборка». Место — карта.
- «Сегодня — сотни миллионов» доказано настоящей страницей с ценой биткоина: камера летит к цене на слове «сегодня».
- Отказ города — живой экран: письмо печатается на словах автора, ответ «отказано» всплывает на «отказали».
- Совет в конце — список, который зритель сделает сам: галочки ставятся на словах «делай резервные копии», рядом персонаж канала с ключом.
- Палитра cream: светлый лист, белые карточки, мягкий свет.
