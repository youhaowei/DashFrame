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

# portless refuses to run an app when no proxy is running: it exits non-zero
# and, under `set -euo pipefail`, takes this launcher down with it -- printing
# the unprivileged-port fallback without ever taking it, so a fresh machine or
# a headless agent is shown the remedy and still gets no dev server.
#
# `portless proxy start` is idempotent and self-deduplicating: it reports an
# already-running proxy on ANY port (verified against a proxy on 1355 while the
# command defaults to 443), and otherwise falls back from 443 to an
# unprivileged port on its own when it cannot prompt for sudo. Letting it pick
# the port keeps that fallback logic in portless rather than duplicating it.
#
# Do NOT gate this on `portless list`: that command loads stored routes and
# exits 0 even when no proxy is running, so it is not a liveness probe.
if ! portless proxy start --https; then
  echo "[dev-web] could not start a portless proxy; start one yourself with:" >&2
  echo "[dev-web]   portless proxy start --https" >&2
  exit 1
fi

# The browser's Origin carries the proxy's port whenever portless fell back off
# 443 (`https://<name>.localhost:1355`), and the server matches Origin by exact
# string (apps/server/src/app.ts allowedOrigin -> `configured.includes(origin)`).
# Passing only the port-less origins makes every same-origin POST and WebSocket
# fail 403 "Origin is not allowed" while the HTML still loads -- which is why a
# plain 200 check on `/` does not catch it. So allow both forms.
#
# `portless get` applies its own worktree-subdomain logic to the HOSTNAME, so
# only its port is reliable here; the hostname is the one this launcher passes
# to `portless --name` below.
CORS_ARGS=(--cors-origin "https://${DEV_NAME}.localhost" --cors-origin "http://${DEV_NAME}.localhost")
PROXY_PORT="$(portless get "${DEV_NAME}" 2>/dev/null | sed -n 's|^https\{0,1\}://[^/]*:\([0-9]\{1,\}\).*$|\1|p' | tail -n 1)"
if [[ -n "${PROXY_PORT}" && "${PROXY_PORT}" != "443" ]]; then
  CORS_ARGS+=(--cors-origin "https://${DEV_NAME}.localhost:${PROXY_PORT}")
  CORS_ARGS+=(--cors-origin "http://${DEV_NAME}.localhost:${PROXY_PORT}")
fi

(cd "${ROOT}" && exec bun run apps/server/src/index.ts --port 0 "${CORS_ARGS[@]}") >"${SERVER_LOG}" 2>&1 &
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

portless "${PORTLESS_ARGS[@]}" "${ROOT}/scripts/dev-web-child.sh" "$@" &
PORTLESS_PID=$!
wait "${PORTLESS_PID}"
