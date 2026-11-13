#!/usr/bin/env bash
# Собирает контекст образа сайта «3Д»: слой поверх ЗАПУЩЕННОГО образа сайта (Dockerfile рядом, команды — README.md).
#
# Что в слое:
#  1. Файлы раздела из этого репозитория: lib/studio3d, app/3d, app/api/3d, tests/studio3d*.test.ts.
#  2. Общие файлы сайта, которые «3Д» правит, — список выдаёт `node patch-live.mjs --list`:
#       app/api/projects/route.ts — скрыть из списка проектов скрытые «зеркала» публикаций «3Д»;
#       lib/publications.ts       — их записи на странице публикаций ведут на /3d/<id>, а не в главный редактор.
#     Эти файлы берутся из ЖИВОЙ основной папки (её незакоммиченная рабочая копия и работает на сайте) и
#     правятся patch-live.mjs. Сами правки живут только в patch-live.mjs: в git их нет, потому что
#     коммит копии общего файла из ветки «3Д» затёр бы чужую незакоммиченную работу в основной папке.
#     Правка — точная замена строк: если живой файл изменился и строка не нашлась, сборка останавливается.
#     Перед правкой копия сверяется с файлом в запущенном контейнере: если в основной папке есть ещё не
#     выкаченные правки (чужие), слой их не повезёт — сборка останавливается (пропуск: STUDIO3D_SKIP_LIVE_CHECK=1).
# Остальное, включая навигацию (app/components/Nav.tsx со ссылкой «3Д» уже в живом сайте), остаётся из образа:
# своя копия общего файла устарела бы и затёрла чужие пункты меню.
#
# Основная папка — та, к которой привязан этот worktree; другая задаётся GUDINI_MAIN=<путь>.
# Контейнер сайта для сверки — gudini-site; другой задаётся GUDINI_SITE_CONTAINER=<имя>.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
main="${GUDINI_MAIN:-$(cd "$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)/.." && pwd)}"
container="${GUDINI_SITE_CONTAINER:-gudini-site}"
out="$here/build"
rm -rf "$out" && mkdir -p "$out/overlay/lib" "$out/overlay/app/api" "$out/overlay/tests"
cp "$here/Dockerfile" "$out/"
cp -r "$repo/lib/studio3d" "$out/overlay/lib/"
cp -r "$repo/app/3d" "$out/overlay/app/"
cp -r "$repo/app/api/3d" "$out/overlay/app/api/"
cp "$repo"/tests/studio3d*.test.ts "$out/overlay/tests/"

if [ "$(cd "$main" && pwd -P)" = "$(cd "$repo" && pwd -P)" ]; then
  echo "✖ Основная папка совпала с этой: общие файлы взять неоткуда. Задайте GUDINI_MAIN=<основная папка>." >&2
  exit 1
fi
shared="$(node "$here/patch-live.mjs" --list)"
for f in $shared; do
  if [ ! -f "$main/$f" ]; then
    echo "✖ В основной папке $main нет $f" >&2
    exit 1
  fi
  mkdir -p "$out/overlay/$(dirname "$f")"
  cp "$main/$f" "$out/overlay/$f"
  echo "  живой $f из $main"
done
node "$here/patch-live.mjs" "$out/overlay"

# Копия из основной папки должна быть тем, что сейчас работает: тот же файл (без правки — до первой выкатки
# «3Д», с ней — после). Иначе в основной папке лежат не выкаченные правки, и слой отправил бы их на сайт.
if [ "${STUDIO3D_SKIP_LIVE_CHECK:-}" = "1" ]; then
  echo "  ! сверка общих файлов с запущенным сайтом пропущена (STUDIO3D_SKIP_LIVE_CHECK=1)" >&2
elif ! MSYS_NO_PATHCONV=1 docker exec "$container" true >/dev/null 2>&1; then
  echo "  ! контейнер $container недоступен — общие файлы с запущенным сайтом не сверены" >&2
else
  for f in $shared; do
    if ! running="$(MSYS_NO_PATHCONV=1 docker exec "$container" cat "/app/$f" | tr -d '\r')"; then
      echo "✖ В $container нет /app/$f — сайт старше основной папки; сначала выкатите основную папку" >&2
      exit 1
    fi
    if [ "$running" != "$(tr -d '\r' <"$main/$f")" ] && [ "$running" != "$(tr -d '\r' <"$out/overlay/$f")" ]; then
      echo "✖ $f в основной папке не тот, что работает в $container: там правки, которых на сайте ещё нет." >&2
      echo "  Слой «3Д» отправил бы их на сайт. Сравните: docker exec $container cat /app/$f | diff - \"$main/$f\"" >&2
      echo "  Если их можно выкатывать вместе с «3Д»: STUDIO3D_SKIP_LIVE_CHECK=1 bash $0" >&2
      exit 1
    fi
    echo "  $f совпадает с запущенным $container"
  done
fi
echo "$out"
