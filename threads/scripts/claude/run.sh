#!/usr/bin/env bash
# Запуск скрипта Claude внутри gudini-threads-app: run.sh <feed|stats|publish|replies|reply> [аргументы].
# Файлы-аргументы (publish, reply) копируются в контейнер рядом со скриптами.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
name="$1"; shift
# Git Bash: пути контейнера не переписываем, а путь на диске Windows передаём docker cp в виде C:\...
export MSYS_NO_PATHCONV=1
host() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
docker exec gudini-threads-app mkdir -p /tmp/claude
docker cp "$(host "$here/$name.mjs")" "gudini-threads-app:/tmp/claude/$name.mjs" >/dev/null
args=()
for a in "$@"; do
  if [ -f "$a" ]; then
    docker cp "$(host "$a")" "gudini-threads-app:/tmp/claude/$(basename "$a")" >/dev/null
    args+=("/tmp/claude/$(basename "$a")")
  else
    args+=("$a")
  fi
done
docker exec -w /app gudini-threads-app node "/tmp/claude/$name.mjs" "${args[@]}"
