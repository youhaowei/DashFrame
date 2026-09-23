#!/usr/bin/env bash
set -euo pipefail

ROOT="${DASHFRAME_DEV_ROOT:?DASHFRAME_DEV_ROOT is required}"
export DASHFRAME_VITE_HOST="${HOST:-}"
VITE_PID=""

cleanup() {
  if [[ -n "${VITE_PID}" ]] && kill -0 "${VITE_PID}" 2>/dev/null; then
    # The command is usually a wrapper (`bunx vp dev`) whose Vite runs as its
    # child; outside portless nothing else reaps that child, so signal it too.
    # This reaches one level down, which covers `bunx vp dev` (vite-plus 0.3.2).
    pkill -TERM -P "${VITE_PID}" 2>/dev/null || true
    kill -TERM "${VITE_PID}" 2>/dev/null || true
    wait "${VITE_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"$@" &
VITE_PID=$!
export DASHFRAME_DEV_VITE_PID="${VITE_PID}"

for _ in {1..200}; do
  if curl --fail --silent --max-time 1 "http://127.0.0.1:${PORT:?PORT is required}/" >/dev/null; then
    node "${ROOT}/scripts/dev-worktree.mjs" write "${ROOT}"
    wait "${VITE_PID}"
    exit $?
  fi
  if ! kill -0 "${VITE_PID}" 2>/dev/null; then
    wait "${VITE_PID}"
    exit $?
  fi
  sleep 0.05
done

echo "[dev-web] timed out waiting for Vite" >&2
exit 1
