#!/usr/bin/env bash
# Собирает контекст образа сайта с вкладкой «Новости»: слой поверх ЗАПУЩЕННОГО образа (Dockerfile рядом, README.md).
#
# Что в слое:
#  1. Файлы раздела из этой ветки: lib/news, app/news, app/api/news, tests/news*.test.ts.
#  2. Общие файлы сайта, которые «Новости» правят (список — `node patch-live.mjs --list`: меню, список проектов,
#     страница публикаций). Они берутся ИЗ ЗАПУЩЕННОГО КОНТЕЙНЕРА, а не из основной папки: часть живых правок
#     (например «3Д» в списке проектов и публикациях) есть только в образе. patch-live.mjs накладывает правки
#     «Новостей» точной заменой строк; не нашлась строка — сборка останавливается.
#  3. Мемы и расходы с сайта убирает Dockerfile (страницы app/memes и app/balances; их API остаются, чтобы не
#     ломать фоновые задания и старые ссылки).
# Контейнер сайта — gudini-site; другой задаётся GUDINI_SITE_CONTAINER=<имя>.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
container="${GUDINI_SITE_CONTAINER:-gudini-site}"
out="$here/build"
rm -rf "$out" && mkdir -p "$out/overlay/lib" "$out/overlay/app/api" "$out/overlay/tests"
cp "$here/Dockerfile" "$out/"
cp -r "$repo/lib/news" "$out/overlay/lib/"
cp -r "$repo/app/news" "$out/overlay/app/"
cp -r "$repo/app/api/news" "$out/overlay/app/api/"
cp "$repo"/tests/news*.test.ts "$out/overlay/tests/"
# шрифт заголовка обложки (lib/news/cover.ts composeNewsCover): Impact этого ПК, в git его нет — шрифт Microsoft, а репозиторий
# публичный; без него обложки собираются шрифтом FreeSans Bold из образа
mkdir -p "$out/overlay/lib/news/fonts"
cp "/c/Windows/Fonts/impact.ttf" "$out/overlay/lib/news/fonts/impact.ttf" 2>/dev/null || echo "  ! нет C:/Windows/Fonts/impact.ttf — обложки будут шрифтом FreeSans Bold"

MSYS_NO_PATHCONV=1 docker exec "$container" true >/dev/null 2>&1 || { echo "✖ контейнер $container недоступен" >&2; exit 1; }
for f in $(node "$here/patch-live.mjs" --list); do
  mkdir -p "$out/overlay/$(dirname "$f")"
  if ! MSYS_NO_PATHCONV=1 docker exec "$container" cat "/app/$f" >"$out/overlay/$f"; then
    echo "✖ В $container нет /app/$f" >&2
    exit 1
  fi
  echo "  живой $f из $container"
done
node "$here/patch-live.mjs" "$out/overlay"
echo "$out"
