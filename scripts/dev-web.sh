#!/usr/bin/env bash
# Start the loopback DashFrame server before Vite, then proxy the web client's
# same-origin /api requests to it. Keeping both processes under one launcher
# prevents Vite's SPA fallback from returning index.html for missing API calls.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_LOG="$(mktemp "${TMPDIR:-/tmp}/dashframe-web-server.XXXXXX")"
SERVER_PID=""
DEV_NAME="$(node "${ROOT}/scripts/dev-worktree.mjs" name "${ROOT}")"
DEV_MANIFEST="$(node "${ROOT}/scripts/dev-worktree.mjs" manifest "${ROOT}")"

# Keep concurrent worktrees off the shared ~/.DashFrame/web-project lock and
# persist preview data across restarts. Callers can still select another project.
export DASHFRAME_PROJECT_DIR="${DASHFRAME_PROJECT_DIR:-${ROOT}/.data/web-project}"

cleanup() {
  node "${ROOT}/scripts/dev-worktree.mjs" clear "${ROOT}" "$$" 2>/dev/null || true
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill -TERM "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  rm -f "${SERVER_LOG}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(cd "${ROOT}" && bun run apps/server/src/index.ts --port 0) >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

WYSTACK_URL=""
for _ in {1..200}; do
  WYSTACK_URL="$(sed -n 's/^\[dashframe\] listening: //p' "${SERVER_LOG}" | tail -n 1)"
  if [[ -n "${WYSTACK_URL}" ]]; then
    break
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "[dev-web] DashFrame server failed to start:" >&2
    sed 's/^/[dev-web]   /' "${SERVER_LOG}" >&2
    exit 1
  fi
  sleep 0.05
done

if [[ -z "${WYSTACK_URL}" ]]; then
  echo "[dev-web] timed out waiting for the DashFrame server" >&2
  sed 's/^/[dev-web]   /' "${SERVER_LOG}" >&2
  exit 1
fi

export VITE_WYSTACK_URL="${WYSTACK_URL}"
export DASHFRAME_DEV_ROOT="${ROOT}"
export DASHFRAME_DEV_LAUNCHER_PID="$$"
export DASHFRAME_DEV_SERVER_PID="${SERVER_PID}"
echo "[dev-web] API proxy: ${VITE_WYSTACK_URL}"
echo "[dev-web] route: ${DEV_NAME}"
echo "[dev-web] runtime manifest: ${DEV_MANIFEST} (created when Vite starts)"

cd "${ROOT}/apps/web"
PORTLESS_ARGS=(--name "${DEV_NAME}")
if [[ "${PORTLESS_FORCE:-0}" == "1" ]]; then
  PORTLESS_ARGS+=(--force)
fi
if [[ -n "${PORT:-}" ]]; then
  PORTLESS_ARGS+=(--app-port "${PORT}")
fi
portless "${PORTLESS_ARGS[@]}" "${ROOT}/scripts/dev-web-child.sh" "$@"
