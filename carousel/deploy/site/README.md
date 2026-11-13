# Карусели формата @siddhantt.ai — выкатка

Слой поверх ЗАПУЩЕННОГО образа сайта: только файлы раздела «Карусели» из ветки `carousel-sid`
(worktree `C:\Users\user\gudini-work\carousel-sid`). Ветка начинается со снимка кода запущенного контейнера
(коммит `142e513`, образ `gudini-gudini-site:news-20261028`), поэтому чужие живые правки слой не трогает.

## Что меняется на сайте
- `/carousel` — одна кнопка «Создать» и список каруселей с обложками и ходом работы (формы темы, числа слайдов и формата нет).
- «Создать» ставит фоновое задание: тема и факты (Claude с поиском через мост каруселей) → тексты → скриншоты
  источников (Chromium в контейнере, закрытые страницы — карточкой статьи) → проверка фактов по страницам →
  обложка (GPT через мост картинок Codex, проверка Claude: без букв и лиц) → 9 слайдов → `video.mp4` 1080×1920.
- Страница карусели: слайды, подпись с правкой, источники, скачать слайды архивом (+ caption.txt и sources.txt),
  скачать видео, публикация и расписание в Instagram и Threads — как раньше.
- Старые карусели (schema 1–3) открываются со старым редактором. «Мемы» слой не трогает и не возвращает.

## Мост каруселей к Claude (на ПК)
`carousel/bridge/claude-bridge.mjs`, порт 127.0.0.1:43143, вход и токен — из `threads/.env` (как у мостов «3Д» и «Новостей»).
Работает из detached worktree на проверенном коммите: `C:\Users\user\gudini-work\carousel-runner`.
Сторож: `carousel\bridge\start-bridge.ps1`; его запускает `deploy\start-gudini.ps1` (строка «мост Claude «Карусели»»).

## Сборка
```bash
cd /c/Users/user/gudini-work/carousel-sid
docker inspect gudini-site --format '{{.Config.Image}}'   # BASE — именно запущенный образ
bash carousel/deploy/site/prepare.sh                        # остановится, если общий файл в проде менялся после снимка
docker build --build-arg BASE=<запущенный образ> -t gudini-gudini-site:carousel-sid-YYYYMMDD carousel/deploy/site/build
```
В образе прогоняются тесты раздела (carouselSid, Store, Routes, Schedule, JobFailure, RunnerRecovery, Instagram, Access) и `npm run build`.

## Выкатка
1. Прежний образ сохранить для отката: `docker tag <запущенный образ> gudini-gudini-site:before-carousel-sid-YYYYMMDD`.
2. `data/carousel-release/compose.sid.yml` (копия `compose.sid.yml` отсюда, тег образа поправить) — последним в цепочке:
   та же цепочка `-f`, что в `com.docker.compose.project.config_files` у `gudini-site`, + `-f data/carousel-release/compose.sid.yml`,
   `up -d --no-deps --no-build gudini-site`. Перед этим: нет идущих заданий каруселей и публикаций (`/api/carousel`), `docker inspect` ещё раз.
3. Готовые карусели 1–4: скопировать папки (01–09.png, video.mp4, caption.txt, meta.json) в контейнер и
   `docker exec gudini-site npx tsx scripts/carousel-sid-import.ts /tmp/sidimport/1 /tmp/sidimport/2 /tmp/sidimport/3 /tmp/sidimport/4`
   (повторный запуск дубликатов не создаёт).

## Откат
Та же команда `up` без `compose.sid.yml` (образ из предыдущего файла цепочки; копия — `before-carousel-sid-YYYYMMDD`).
Карусели формата, созданные после выкатки, в старом интерфейсе открываются как обычные готовые слайды.
