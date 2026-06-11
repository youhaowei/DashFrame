#!/usr/bin/env bash
# Single entrypoint for terminal dev and Claude Preview, for the
# @dashframe/web app. Runs vite through portless so it gets a stable
# https://dashframe.localhost URL. In a git worktree, portless prepends
# the branch slug as a subdomain (<branch>.dashframe.localhost), so every
# worktree runs its own copy without port conflicts; `portless list` shows
# which route maps to which port.
# - No PORT env (terminal): portless auto-assigns a random free port.
# - PORT env set (Preview MCP): forward as --app-port so portless binds
#   where Preview will iframe.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../apps/web"

if [[ -n "${PORT:-}" ]]; then
  exec portless run --app-port "${PORT}" "$@"
else
  exec portless run "$@"
fi
