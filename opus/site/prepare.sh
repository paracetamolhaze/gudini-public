#!/usr/bin/env bash
# Контекст сборки слоёв «Опус 5.5» для сайта и воркера (Dockerfile.site / Dockerfile.worker рядом).
#  - новые файлы: lib/opusScript.ts (сайт), lib/opusEngine.ts (оба);
#  - общие файлы берутся ИЗ ЗАПУЩЕННЫХ КОНТЕЙНЕРОВ (там правки других разделов, которых нет в git) и правятся
#    patch-live.mjs; не нашлась строка — сборка останавливается.
#   bash prepare.sh   → build/site и build/worker
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/build"
rm -rf "$out"
for part in site worker; do
  container="gudini-$part"
  dir="$out/$part"
  mkdir -p "$dir/overlay/lib"
  cp "$here/Dockerfile.$part" "$dir/Dockerfile"
  cp "$here/lib/opusEngine.ts" "$dir/overlay/lib/"
  [ "$part" = site ] && cp "$here/lib/opusScript.ts" "$dir/overlay/lib/"
  for f in $(node "$here/patch-live.mjs" --list "$part"); do
    mkdir -p "$dir/overlay/$(dirname "$f")"
    MSYS_NO_PATHCONV=1 docker exec "$container" cat "/app/$f" >"$dir/overlay/$f" || { echo "✖ в $container нет /app/$f" >&2; exit 1; }
  done
  node "$here/patch-live.mjs" "$part" "$dir/overlay"
  echo "$part: $dir"
done
