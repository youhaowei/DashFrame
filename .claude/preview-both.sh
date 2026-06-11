#!/usr/bin/env bash
# Launch the web app (previewable in Claude's Preview pane) AND the desktop
# Electron app (native window) at the same time, from one action.
#
# Why this shape:
#   - The web app must stay a single foreground portless process so Claude
#     Preview can iframe it (it owns the PORT env and the iframe URL). So web
#     runs in the FOREGROUND through the existing portless-shim, unchanged.
#   - The desktop app is a native Electron window, not an iframe-able URL. It
#     runs in the BACKGROUND via `bun run dev` (which builds the
#     wystack→server-core→server→main chain, starts its own renderer Vite
#     server on :5173, and launches Electron). It pops as its own window.
#
# Lifecycle: dev's own dev.mjs installs SIGTERM handlers that kill its
# Electron + Vite children, so on exit we just signal that one process and its
# handler cascades the teardown. (No setsid — not available on macOS.)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

desktop_pid=""
cleanup() {
  if [[ -n "${desktop_pid}" ]] && kill -0 "${desktop_pid}" 2>/dev/null; then
    # dev.mjs traps SIGTERM and kills its electron + vite children.
    kill -TERM "${desktop_pid}" 2>/dev/null || true
    wait "${desktop_pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# 1. Desktop in the background. dev handles its own build + launch and
#    its own child-process cleanup on SIGTERM.
echo "[preview-both] starting desktop (Electron native window)…"
(cd "${ROOT}" && bun run dev) &
desktop_pid=$!

# 2. Web in the foreground through portless-shim — Preview iframes this. The
#    shim forwards the Preview-injected PORT to portless as --app-port.
#    Not `exec`: the script must stay alive so the EXIT trap can tear down the
#    desktop process when Preview stops the web.
echo "[preview-both] starting web (previewable) on portless…"
"${ROOT}/.claude/portless-shim.sh" bunx vite
