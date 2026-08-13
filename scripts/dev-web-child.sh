#!/usr/bin/env bash
set -euo pipefail

ROOT="${DASHFRAME_DEV_ROOT:?DASHFRAME_DEV_ROOT is required}"
export DASHFRAME_VITE_HOST="${HOST:-}"
node "${ROOT}/scripts/dev-worktree.mjs" write "${ROOT}"
exec "$@"
