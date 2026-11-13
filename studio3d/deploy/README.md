# Контейнер «3Д» (gudini-3d)

Раздел сайта `/3d` только хранит проекты и раздаёт задания. Всю работу делает отдельный контейнер `gudini-3d`:

1. раз в 5 секунд спрашивает у сайта задание (`POST /api/3d/runner/claim`, вход `worker:<пароль сайта>`, как у воркера);
2. берёт одно задание за раз и каждые 5 секунд шлёт пульс с текущим шагом (`/progress`); если сайт ответил 409 — задание
   отдано другому, работа сразу останавливается;
3. «Сценарий»: Claude через мост пишет диалог владельца и Клода → `/script` → `/complete`;
4. «Монтаж»: озвучка ElevenLabs, режиссура Claude, рендер Remotion + three.js без видеокарты → ролик уходит на сайт
   кусками по 4 МБ (`PUT /video/<id>`, при обрыве продолжает с того места, что уже на сайте) → `/complete`
   с длительностью и версией сценария;
5. любая ошибка уходит на сайт короткой строкой по-русски (до 600 знаков, с причиной) — её видно под заданием.

Контейнер — отдельный compose-проект `gudini3d`: его сборка и перезапуск не трогают сайт, воркер, Clipy и Threads.
Он подключён к сети основного проекта `gudini_default`, поэтому видит сайт по адресу `http://gudini-site:3000`.
Видеокарту не использует (она у Clipy).

Код исполнителя — `studio3d/runner/`, режиссёр — `studio3d/director/`, мост к Claude — `studio3d/bridge/`.
Типы протокола — `lib/studio3d/types.ts`, их копия в контейнере — `studio3d/runner/protocol.ts` (менять вместе).

## Команды

Все команды — из корня репозитория `C:\Users\user\Desktop\gudini`, в PowerShell или Git Bash. Метку образа берите
по дате, например `20261021-1500`.

| Что | Команда |
| --- | --- |
| Собрать | `docker build -f studio3d/deploy/Dockerfile -t gudini-3d:20261021-1500 studio3d` |
| Назначить рабочим | `docker tag gudini-3d:20261021-1500 gudini-3d:latest` |
| Запустить / обновить | `docker compose -f studio3d/deploy/compose.yml up -d` |
| Откатить | `docker tag gudini-3d:<прежняя метка> gudini-3d:latest; docker compose -f studio3d/deploy/compose.yml up -d --force-recreate` |
| Остановить | `docker compose -f studio3d/deploy/compose.yml stop` |
| Список образов | `docker images gudini-3d` |

- Сборка сама проверяет типы (`tsc`) и гоняет тесты исполнителя: при ошибке образ не собирается, выкатывать нечего.
- Перед обновлением убедитесь, что контейнер ничего не делает (`docker logs --tail 20 gudini-3d`). Перезапуск посреди
  задания не ломает сайт: исполнитель успевает сообщить «Контейнер 3Д остановили посреди задания — запустите его снова»,
  но сделанная работа пропадает.
- Сначала должен быть запущен основной проект (`docker compose up -d` в корне): без сети `gudini_default` контейнер
  не стартует.
- Пока ветка `studio-3d` не влита и команды идут из worktree `C:\Users\user\gudini-work\3d`, у worktree нет своего
  `.env`. Тогда запуск — с папкой проекта в основной копии (пути в compose считаются от неё, папка может не существовать):
  `docker compose -f studio3d/deploy/compose.yml --project-directory C:/Users/user/Desktop/gudini/studio3d/deploy up -d`

## Исполнитель на ПК: рендер на видеокарте

С 2026-10-22 задания берёт не контейнер, а тот же исполнитель, запущенный прямо в Windows: в Docker у Chrome нет
видеокарты, а на ПК 3D рисует RTX 3060 Ti через Direct3D (`STUDIO3D_GL=angle`). Замер на тестовой сцене: 10,2 кадра/с
с 2 кадрами разом против 1,3 на процессоре, картинка та же (разница меньше 1/255). Видеокарта занята лишь частично,
а сторож ставит исполнителю пониженный приоритет — его наследуют node и Chrome рендера, игра и рабочий стол идут первыми.
Контейнер остаётся запасным: работать должен кто-то один, иначе задания разбирают оба.

С 2026-10-23 вид рендера зависит от машины (`director/render.ts`): на видеокарте 3D рисуется в полный размер
(`STUDIO3D_DPR` 1) с глубиной резкости и свечением (`STUDIO3D_POST`), без неё — 0,75 и без проходов, экраны
размываются сами. Звуки (`public/sfx`, `scripts/sfx.py`: клавиши, «поп», «дзынь», писк, «вжух»; без гула комнаты)
включены с 2026-10-23, когда владелец их послушал; выключает их `STUDIO3D_SFX=0`.

- Папка исполнителя — отдельный worktree `C:\Users\user\gudini-work\3d-runner` на проверенном коммите (не рабочая копия
  разработки), в ней свои `node_modules` и шрифт `studio3d/public/fonts/ObelixProB-cyr.ttf` (его нет в git).
- Сторож: `studio3d/deploy/host/start-runner.ps1` — запускает `node --import tsx runner/index.ts` скрыто и поднимает
  снова, если тот упал; ключи берёт из `C:\Users\user\Desktop\gudini\.env`; сайт — `http://127.0.0.1:3000`;
  рендер `angle` × 2; работа — `%USERPROFILE%\gudini-3d-data\work`. Второй сторож рядом с первым сам выходит.
- Запустить:
  `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\Users\user\gudini-work\3d-runner\studio3d\deploy\host\start-runner.ps1`
- Журнал: `Get-Content -Wait -Tail 50 -Encoding UTF8 C:\Users\user\gudini-work\3d-runner\studio3d\.work\runner.log`
- Остановить сторожа и исполнитель:
  `Get-CimInstance Win32_Process | Where-Object CommandLine -like '*start-runner.ps1*' | ForEach-Object { Stop-Process -Id $_.ProcessId }; Get-CimInstance Win32_Process | Where-Object CommandLine -like '*gudini-3d-runner*runner/index.ts*' | ForEach-Object { Stop-Process -Id $_.ProcessId }`
- Автозапуск при входе в Windows: `shell:startup\gudini-studio3d-runner.cmd` (как у моста).
- Обновить на новый коммит (когда исполнитель ничего не делает):
  `git -C C:\Users\user\gudini-work\3d-runner checkout --detach <коммит>`, затем `npm ci` в `studio3d`, затем перезапустить сторожа.
- Вернуть работу контейнеру: остановить сторожа (и убрать его из автозапуска), затем
  `docker compose -f studio3d/deploy/compose.yml up -d`.

## Мост к Claude (Windows)

Сценарий и режиссуру пишет Claude Code приложения Claude на подписке владельца — через свой мост
`studio3d/bridge/claude-bridge.mjs` (копия моста Астры со своим промптом и портом). Мост слушает только
`127.0.0.1:43135`, контейнер ходит к нему по `http://host.docker.internal:43135`, каждый запрос — с токеном
`CLAUDE_BRIDGE_TOKEN`. Мост тратит тот же лимит подписки, что и остальные мосты, поэтому запускается только
с согласия владельца. Задания идут по одному; если контейнер оборвал запрос (задание остановили или отдали
другому), мост сразу гасит этот запуск Claude, чтобы следующее задание не ждало брошенный ответ.

- Разово, в открытом окне: `node studio3d\bridge\claude-bridge.mjs`
- Скрыто, со сторожем (поднимает мост снова, если тот упал; второй сторож сам выходит):
  `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\Users\user\Desktop\gudini\studio3d\bridge\start-bridge.ps1`
- Журнал моста и сторожа: `studio3d\.work\claude-bridge.log`
  (смотреть: `Get-Content -Wait -Tail 50 -Encoding UTF8 C:\Users\user\Desktop\gudini\studio3d\.work\claude-bridge.log`)
- Проверить, что жив (токен читается из файла и не печатается):
  `$t = (Select-String C:\Users\user\Desktop\gudini\threads\.env -Pattern '^CLAUDE_BRIDGE_TOKEN=(.*)$').Matches[0].Groups[1].Value; Invoke-RestMethod http://127.0.0.1:43135/health -Headers @{ Authorization = "Bearer $t" }`
  — в ответе `"service": "studio3d-claude-bridge"`.
- Проверить код моста без Claude и без лимита (вместо `claude.exe` — заглушка, порт случайный):
  `node --test studio3d/bridge/claude-bridge.test.mjs`
- Остановить сторожа и мост:
  `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object CommandLine -like '*start-bridge.ps1*' | ForEach-Object { Stop-Process -Id $_.ProcessId }; Get-NetTCPConnection -LocalPort 43135 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }`

### Автозапуск при входе в Windows

Сторож сам в автозапуск не ставится. Чтобы мост поднимался при входе в систему, владелец создаёт ярлык в папке
автозапуска: Win+R → `shell:startup` → «Создать → Ярлык», объект:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\user\Desktop\gudini\studio3d\bridge\start-bridge.ps1"
```

Убрать из автозапуска — удалить этот ярлык из той же папки.

## Настройки

Контейнер читает корневой `.env` (тот же, что у сайта и воркера); адреса задаёт `compose.yml`.

| Переменная | Где | Зачем |
| --- | --- | --- |
| `GUDINI_URL` | compose: `http://gudini-site:3000` | адрес сайта; значение из `.env` здесь перекрыто |
| `GUDINI_PASSWORD` или `SITE_PASSWORD` | `.env` | пароль сайта для входа `worker:<пароль>`; без него контейнер пишет в журнал и ждёт |
| `STUDIO3D_WORK` | compose: `/data/work` | рабочие папки проектов |
| `STUDIO3D_CLAUDE_URL` | compose: `http://host.docker.internal:43135` | мост к Claude |
| `CLAUDE_BRIDGE_TOKEN` | `.env` | токен моста; должен совпадать с тем, что в `threads\.env` (мост читает его оттуда) |
| `ELEVENLABS_API_KEY` | `.env` | озвучка; ключу нужны права Text to Speech и Voices: Read |

Мост (Windows) читает `threads\.env` (`STUDIO3D_CLAUDE_ENV`, если файл другой) и переменные:
`STUDIO3D_CLAUDE_HOST` (127.0.0.1), `STUDIO3D_CLAUDE_PORT` (43135), `STUDIO3D_CLAUDE_MODEL` (claude-opus-5-5),
`STUDIO3D_CLAUDE_EFFORT` (high), `STUDIO3D_CLAUDE_CONCURRENCY` (1), `STUDIO3D_CLAUDE_TIMEOUT_MS` (25 минут),
`STUDIO3D_CLAUDE_EXE` (путь к `claude.exe`, если не брать новейший из приложения), `CLAUDE_CODE_OAUTH_TOKEN`,
`CLAUDE_CODE_GIT_BASH_PATH`.

## Где данные

- Том `gudini3d_gudini3d-data` → `/data` в контейнере; рабочая папка проекта — `/data/work/<id проекта>`
  (озвучка, сцена, черновики, итоговый ролик). Переживает пересборку и перезапуск.
- Готовый ролик после загрузки хранится на сайте (том `gudini_gudini-site-data`), рабочие папки после этого
  можно чистить. Сколько занято: `docker exec gudini-3d du -sh /data/work`.

## Журналы

- Контейнер: `docker logs -f --tail 100 gudini-3d` — строки с временем ISO и `[<id проекта> <задача>]`.
- Мост: `studio3d\.work\claude-bridge.log` (см. выше).
- Состояние: `docker ps --filter name=gudini-3d`, `docker inspect -f "{{.State.Status}} {{.RestartCount}}" gudini-3d`.
