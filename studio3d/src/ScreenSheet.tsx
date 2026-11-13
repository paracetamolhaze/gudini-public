import React, { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender } from "remotion";
import { fontsReady } from "./fonts";
import { APP_SIZE, DESK_SIZE, appName, paintDesktop, paintScreen, type ScreenContent, type Surface } from "./kit/ScreenApps";

/** One screen of the room as the texture draws it, before the room's light and the lens soften it. */
const picture = (surface: Surface, content: ScreenContent, t: number) => {
  const [aw, ah] = APP_SIZE[surface];
  const [dw, dh] = DESK_SIZE[surface];
  const app = document.createElement("canvas"); app.width = aw; app.height = ah;
  paintScreen(app.getContext("2d")!, aw, ah, surface, content, t);
  const desk = document.createElement("canvas"); desk.width = dw; desk.height = dh;
  paintDesktop(desk.getContext("2d")!, surface, app, appName(content, surface));
  return desk.toDataURL();
};

const SAMPLES: [Surface, ScreenContent][] = [
  ["monitor", { app: "chat", title: "Стоит ли покупать курс по трейдингу за 50 тысяч?", lines: ["Сначала проверь, на чём зарабатывает сам автор.", "Если главный доход — продажа курса, это и есть его трейдинг."], since: 6 }],
  ["monitor", { app: "news", title: "Крипто новости", lines: ["Трейдеры потеряли $1,2 млрд на ликвидациях за сутки", "Биткоин упал на 8% за час", "Регулятор предупредил о курсах-пирамидах", "Плечо x100: почему новички теряют депозит"], since: 6 }],
  ["monitor", { app: "wallet", title: "Доход автора курса", lines: ["5 000 000", "+50 000 ученик №1", "+50 000 ученик №2", "−2 400 комиссия"], since: 6 }],
  ["vertical", { app: "feed", title: "Lambo Trading Academy", lines: ["Курс «Трейдер с нуля» — старт продаж!", "Ученик заработал +340% за неделю", "Осталось 3 места по старой цене", "Скидка 20% до полуночи"], since: 6 }],
  ["vertical", { app: "chart", title: "BTC/USDT", lines: ["64 210", "−8,4%"], trend: "dump", since: 6 }],
  ["vertical", { app: "home", title: "", lines: [], since: 6 }],
  ["monitor", { app: "position", title: "BTC/USDT ×50", lines: ["LONG ×50  1 000 USDT", "Вход 64 210", "Цена 62 950  ▼ −1,96%", "PnL −98%", "Статус: ликвидирован"], trend: "dump", since: 6 }],
  ["vertical", { app: "position", title: "BTC/USDT ×50", lines: ["LONG ×50  1 000 USDT", "Вход 64 210", "Цена 62 950  ▼ −1,96%", "PnL −98%", "Статус: ликвидирован"], trend: "dump", since: 6 }],
];

/** Every kind of screen of the room on one page, at full size, to check the art pixel by pixel (dev only). */
export const ScreenSheet: React.FC = () => {
  const [handle] = useState(() => delayRender("Шрифты экранов"));
  const [ready, setReady] = useState(false);
  useEffect(() => { fontsReady.then(() => { setReady(true); continueRender(handle); }); }, [handle]);
  if (!ready) return null;
  return (
    <AbsoluteFill style={{ background: "#0c0e16", padding: 20, display: "flex", flexWrap: "wrap", gap: 20, alignContent: "flex-start" }}>
      {SAMPLES.map(([surface, content], i) => (
        <img key={i} src={picture(surface, content, 3)} style={surface === "monitor" ? { width: 1180 } : { width: 560 }} />
      ))}
    </AbsoluteFill>
  );
};
