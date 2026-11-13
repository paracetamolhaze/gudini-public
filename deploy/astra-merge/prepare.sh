#!/usr/bin/env bash
# Контекст сборки слоёв «одна Астра» для сайта и воркера (Dockerfile.site / Dockerfile.worker рядом).
#  - общие файлы берутся ИЗ ЗАПУЩЕННЫХ КОНТЕЙНЕРОВ (там правки других разделов, которых нет в git) и правятся
#    patch-live.mjs; не нашлась строка — сборка останавливается;
#  - воркеру кладётся учебник Астры из этой рабочей копии (astra-engine/knowledge).
#   bash prepare.sh   → build/site и build/worker
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
out="$here/build"
rm -rf "$out"
for part in site worker; do
  container="gudini-$part"
  dir="$out/$part"
  mkdir -p "$dir/overlay"
  cp "$here/Dockerfile.$part" "$dir/Dockerfile"
  for f in $(node "$here/patch-live.mjs" --list "$part"); do
    mkdir -p "$dir/overlay/$(dirname "$f")"
    MSYS_NO_PATHCONV=1 docker exec "$container" cat "/app/$f" >"$dir/overlay/$f" || { echo "✖ в $container нет /app/$f" >&2; exit 1; }
  done
  node "$here/patch-live.mjs" "$part" "$dir/overlay"
  if [ "$part" = worker ]; then
    mkdir -p "$dir/overlay/astra-engine"
    cp -r "$repo/astra-engine/knowledge" "$dir/overlay/astra-engine/knowledge"
  fi
  echo "$part: $dir"
done
