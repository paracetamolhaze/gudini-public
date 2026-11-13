#!/usr/bin/env bash
# Собирает контекст образа сайта с каруселями формата @siddhantt.ai: слой поверх ЗАПУЩЕННОГО образа.
#
# Ветка carousel-sid начинается со снимка кода запущенного контейнера (коммит BASE ниже), поэтому в слой идут
# только файлы, изменённые после снимка (раздел «Карусели», его тесты и скрипт переноса готовых каруселей).
# Перед этим каждый изменённый файл сверяется с запущенным контейнером: он должен быть таким, каким его оставила
# прошлая выкатка ветки (DEPLOYED), а если ветка его ещё не выкатывала — таким, как в снимке. Если его поменяла
# другая выкатка, сборка останавливается: слой не должен откатить чужую правку. Файлы, удалённые из ветки после
# прошлой выкатки, перечисляются в removed.txt — Dockerfile убирает их из образа. Мост Claude (carousel/bridge)
# в образ не идёт: он работает на ПК.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
container="${GUDINI_SITE_CONTAINER:-gudini-site}"
base="${BASE_COMMIT:-142e513}"
deployed="${DEPLOYED_COMMIT:-e9fa26e}"
out="$here/build"
rm -rf "$out" && mkdir -p "$out/overlay"
cp "$here/Dockerfile" "$out/"
MSYS_NO_PATHCONV=1 docker exec "$container" true >/dev/null 2>&1 || { echo "✖ контейнер $container недоступен" >&2; exit 1; }
live_of() { MSYS_NO_PATHCONV=1 docker exec "$container" sh -c "cat '/app/$1' 2>/dev/null | tr -d '\r' | sha1sum" | cut -c1-40; }
changed=$(git -C "$repo" diff --name-only --diff-filter=AMR "$base" HEAD -- lib app tests scripts fonts)
for f in $changed; do
  ref=""
  if git -C "$repo" cat-file -e "$deployed:$f" 2>/dev/null; then ref="$deployed"; elif git -C "$repo" cat-file -e "$base:$f" 2>/dev/null; then ref="$base"; fi
  if [ -n "$ref" ]; then
    snap=$(git -C "$repo" show "$ref:$f" | tr -d '\r' | sha1sum | cut -c1-40)
    if [ "$(live_of "$f")" != "$snap" ]; then echo "✖ /app/$f в $container не совпадает с $ref — его поменяла другая выкатка, пересоберите ветку поверх нового прода" >&2; exit 1; fi
  fi
  mkdir -p "$out/overlay/$(dirname "$f")"
  git -C "$repo" show "HEAD:$f" > "$out/overlay/$f"
  echo "  $f"
done
git -C "$repo" diff --name-only --diff-filter=D "$deployed" HEAD -- lib app tests scripts fonts > "$out/removed.txt"
for f in $(cat "$out/removed.txt"); do echo "  − $f"; done
echo "$out"
