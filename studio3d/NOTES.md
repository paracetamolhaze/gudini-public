# Монтаж «3Д»

3D-скетчи для канала владельца про крипту: его воксельный двойник и Клод (оранжевый кубик) разговаривают
ночью на гигантской клавиатуре. Без съёмки и без ручной озвучки: сценарий и режиссуру пишет Claude через свой
мост, голоса — ElevenLabs, рендер — Remotion + three.js программным WebGL (без видеокарты).
Отдельный раздел: свой пакет, свои промпты, своя вкладка `/3d`, свой контейнер; Астру и «Картинки» не трогает.

## Как идёт один ролик

1. Владелец на `/3d` пишет идею → сайт ставит задачу «script».
2. Контейнер `gudini-3d` (`runner/`) берёт задачу, Claude пишет диалог по `knowledge/writer.md`.
3. Владелец правит реплики и жмёт «Озвучить и смонтировать» → задача «montage»:
   - `director/voice.ts` — ElevenLabs Text-to-Dialogue with timestamps (одна дорожка, кто когда говорит,
     время каждой буквы → губы и субтитры, `director/mouth.ts`); озвучка кешируется по хешу;
   - `director/music.ts` — трек владельца (Memory Reboot) на −30 LUFS под голосом;
   - Claude пишет `src/scene/Scene.tsx` из кубиков `src/kit` по `knowledge/director.md` и `kit.md`;
   - проверка `director/validate.ts` (AST) + tsc, до трёх кругов правок;
   - черновые кадры середин планов → Claude смотрит и правит патчем;
   - целевой кадр (`director/dream.ts`, по скиллу dream-loop): пока рендерятся черновые кадры, Claude-постановщик
     выбирает 1–2 ключевых момента (`knowledge/dream.md`), GPT через мост картинок (:43129, подписка, $0) рисует
     цель по черновому кадру → `dream-N.jpg`; отдельный вызов-критик (`knowledge/critic.md`; сцену не собирал, код видит только как справку «что уже попросили»)
     сравнивает кадр сцены с целью → `dream/critic-N.json`; отличия «исправимо набором» идут режиссёру вместе
     с правками по черновику, «набору не хватает» — в `dream/report.json` и журнал. Второй круг — кадры
     исправленной сцены против той же цели. С картинками в `style-ref/` цель рисуется в стиле образца владельца.
     Выключатель `STUDIO3D_DREAM=0`; `STUDIO3D_DREAM_ROUNDS` (1–2), `STUDIO3D_DREAM_FRAMES` (1–2); любая ошибка
     шага оставляет монтаж прежним. Нужен `CODEX_BRIDGE_TOKEN` (сторож берёт его из .env);
   - финальный рендер `director/render.ts` (`gl: "swangle"`, dpr 0.75, 4 вкладки) и громкость −14 LUFS.
4. Видео загружается на сайт (`/api/3d/runner/video`), страница проекта показывает его и «Скачать».

## Скорость

SwiftShader — единственный WebGL без GPU в Docker. Замеры 2026-10-21 в образе воркера: 4,4 кадра/с
(dpr 0.75, 4 вкладки), dpr 1 — 2,4. Минута ролика — около 7 минут рендера; весь путь с Claude ≈ 12–15 минут.

## Проверка руками

- `npx tsx scripts/try-script.ts <{topic}.json> out/script.json` — сценарий через мост.
- `npx tsx scripts/try-montage.ts out/script.json <{topic}.json> <имя>` — весь монтаж в `out/try/<имя>`.
- `npx tsx scripts/rerender.ts out/try/<имя>` — та же сцена Claude с текущими кубиками и внешностью.
- `npx tsx scripts/stills.ts <папка монтажа> <куда> 1,5.2,9.5` — кадры готового монтажа с текущими кубиками (сравнить до и после).
- `npx tsx scripts/try-dream.ts <копия папки задания>` — черновик с целевым кадром и критиком на готовом монтаже, без рендера ролика.
- `python scripts/sfx.py` — заново синтезировать звуки комнаты в `public/sfx`.
- `npx tsx scripts/render-test.ts stills 30,90` / `video 0-149 4` — кадры и скорость тестовой сцены.
- `npx remotion still src/index.ts FaceSheet out/faces.png --gl=swangle` — все лица и значки на одном листе.
- `npx tsx scripts/voice-design.ts <spec.json>` — пробы голосов Voice Design; `--save <id> <имя>` сохраняет.
- Тесты: `npx tsx --test director/*.test.ts runner/*.test.ts`, `node --test bridge/claude-bridge.test.mjs`,
  из корня — `npx tsx --test tests/studio3dStore.test.ts tests/studio3dRoutes.test.ts`.

## Правила

- Монтаж Claude руками не правится: ошибка решения → урок в `knowledge/`, ошибка отрисовки → кубик в `src/kit`.
- Внешность и голоса — `cast.json` (в контейнере можно подменить файлом из тома: `STUDIO3D_CAST`).
- Мост `bridge/claude-bridge.mjs` слушает только 127.0.0.1:43135; контейнер ходит через host.docker.internal.
- Выкатка — `deploy/README.md` (контейнер) и `deploy/site/` (сайт слоем поверх запущенного образа).
