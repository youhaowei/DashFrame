#!/usr/bin/env bash
# Start the loopback DashFrame server before Vite, then proxy the web client's
# same-origin /api requests to it. Keeping both processes under one launcher
# prevents Vite's SPA fallback from returning index.html for missing API calls.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_LOG="$(mktemp "${TMPDIR:-/tmp}/dashframe-web-server.XXXXXX")"
SERVER_PID=""
PORTLESS_PID=""
DEV_NAME="$(node "${ROOT}/scripts/dev-worktree.mjs" name "${ROOT}")"
DEV_MANIFEST="$(node "${ROOT}/scripts/dev-worktree.mjs" manifest "${ROOT}")"

# Keep concurrent worktrees off the shared ~/.DashFrame/web-project lock and
# persist preview data across restarts. Callers can still select another project.
export DASHFRAME_PROJECT_DIR="${DASHFRAME_PROJECT_DIR:-${ROOT}/.data/web-project}"

cleanup() {
  if [[ -n "${PORTLESS_PID}" ]] && kill -0 "${PORTLESS_PID}" 2>/dev/null; then
    kill -TERM "${PORTLESS_PID}" 2>/dev/null || true
    wait "${PORTLESS_PID}" 2>/dev/null || true
  fi
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill -TERM "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  for _ in {1..100}; do
    if node "${ROOT}/scripts/dev-worktree.mjs" clear-stopped "${ROOT}" "$$" 2>/dev/null; then
      break
    fi
    sleep 0.05
  done
  rm -f "${SERVER_LOG}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(cd "${ROOT}" && exec bun run apps/server/src/index.ts --port 0 --cors-origin "https://${DEV_NAME}.localhost" --cors-origin "http://${DEV_NAME}.localhost") >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

DASHFRAME_URL=""
for _ in {1..1200}; do
  DASHFRAME_URL="$(sed -n 's/^\[dashframe\] listening: //p' "${SERVER_LOG}" | tail -n 1)"
  if [[ -n "${DASHFRAME_URL}" ]]; then
    break
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "[dev-web] DashFrame server failed to start:" >&2
    sed 's/^/[dev-web]   /' "${SERVER_LOG}" >&2
    exit 1
  fi
  sleep 0.25
done

if [[ -z "${DASHFRAME_URL}" ]]; then
  echo "[dev-web] timed out waiting for the DashFrame server" >&2
  sed 's/^/[dev-web]   /' "${SERVER_LOG}" >&2
  exit 1
fi

export VITE_DASHFRAME_URL="${DASHFRAME_URL}"
export DASHFRAME_DEV_ROOT="${ROOT}"
export DASHFRAME_DEV_LAUNCHER_PID="$$"
export DASHFRAME_DEV_SERVER_PID="${SERVER_PID}"
echo "[dev-web] API proxy: ${VITE_DASHFRAME_URL}"
echo "[dev-web] route: ${DEV_NAME}"
echo "[dev-web] runtime manifest: ${DEV_MANIFEST} (created when the route is ready)"

cd "${ROOT}/apps/web"
PORTLESS_ARGS=(--name "${DEV_NAME}")
if [[ "${PORTLESS_FORCE:-0}" == "1" ]]; then
  PORTLESS_ARGS+=(--force)
fi
if [[ -n "${PORT:-}" ]]; then
  PORTLESS_ARGS+=(--app-port "${PORT}")
fi
# portless needs a proxy already running: the run path refuses when there is
# none and exits non-zero, which under `set -e` takes this launcher down with
# it. It prints the unprivileged-port fallback ("portless proxy start --port
# 1355 --https") but never takes it, so an agent or a fresh machine sees the
# remedy and still gets no dev server. Start one only when none exists --
# `portless list` succeeds whenever a proxy is up, including one on 443, so an
# existing privileged proxy is left alone rather than shadowed by a second one
# on 1355. `proxy start` is itself idempotent and falls back to an unprivileged
# port when 443 would need a sudo password it cannot prompt for.
if ! portless list >/dev/null 2>&1; then
  echo "[dev-web] no portless proxy running; starting one on port ${PORTLESS_PROXY_PORT:-1355}"
  portless proxy start --port "${PORTLESS_PROXY_PORT:-1355}" --https || {
    echo "[dev-web] could not start a portless proxy; start one yourself with:" >&2
    echo "[dev-web]   portless proxy start --port ${PORTLESS_PROXY_PORT:-1355} --https" >&2
    exit 1
  }
fi

portless "${PORTLESS_ARGS[@]}" "${ROOT}/scripts/dev-web-child.sh" "$@" &
PORTLESS_PID=$!
wait "${PORTLESS_PID}"
