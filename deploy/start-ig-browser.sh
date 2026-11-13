#!/bin/sh
set -eu
export DISPLAY=:98
# Docker restart keeps /tmp but terminates the previous X server.
rm -f /tmp/.X98-lock /tmp/.X11-unix/X98
# This dedicated container is the sole owner of this profile. Recreate changes
# its hostname; Chromium otherwise treats locks from the stopped container as live.
rm -f /app/data/trends/browser/profile/SingletonLock /app/data/trends/browser/profile/SingletonCookie /app/data/trends/browser/profile/SingletonSocket
Xvfb "$DISPLAY" -screen 0 1280x900x24 -nolisten tcp &
display_pid=$!
attempt=0
while [ ! -S /tmp/.X11-unix/X98 ]; do
  kill -0 "$display_pid" 2>/dev/null || exit 1
  attempt=$((attempt + 1))
  [ "$attempt" -lt 100 ] || exit 1
  sleep 0.1
done
exec "$@"
