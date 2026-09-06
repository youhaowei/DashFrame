#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Brings a fresh cloud checkout to the state `bun run setup` produces locally:
# submodules initialized, workspace dependencies installed, the vendored
# @wystack/* packages built, and the pinned local Convex backend provisioned.
# Runs only in remote (web) sessions; a local checkout is left alone.
#
# Each provisioning step is skipped once its output exists, so a resumed
# session never moves a submodule off a parked branch or re-resolves a
# `bun link` (AGENTS.md -> Worktrees: install once per checkout, and
# nothing syncs submodules automatically).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

log() { echo "[session-start] $*" >&2; }

# 0. Toolchain. The repo pins bun in package.json (packageManager); an
#    image that ships another version runs installs and tests on an
#    unsupported toolchain. Install the exact pinned release through npm,
#    which verifies the package against the registry, rather than piping a
#    remote installer script into bash. Fail unless the pinned version is
#    what `bun` resolves to afterwards.
pinned=$(node -p "require('./package.json').packageManager.split('@')[1]")
current=$(command -v bun >/dev/null 2>&1 && bun --version || echo "none")
if [ "$current" != "$pinned" ]; then
  log "bun $current on PATH; installing pinned bun@$pinned via npm"
  npm install -g "bun@$pinned"
  hash -r
fi
current=$(command -v bun >/dev/null 2>&1 && bun --version || echo "none")
if [ "$current" != "$pinned" ]; then
  log "ERROR: bun $current is first on PATH after install; pinned $pinned is required"
  exit 1
fi
log "bun $current (pinned $pinned)"

# 1. Submodules (libs/wystack, libs/stdui) — only the ones never checked out.
#    `git submodule status` prefixes an uninitialized submodule with '-'.
uninitialized=$(git submodule status | awk '$1 ~ /^-/ { print $2 }')
if [ -n "$uninitialized" ]; then
  log "initializing submodules: $(echo "$uninitialized" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  git submodule update --init --recursive -- $uninitialized
else
  log "submodules already initialized; leaving checkouts untouched"
fi

# 2. Workspace dependencies — once per checkout, lockfile honored as-is.
if [ ! -d node_modules ]; then
  log "installing dependencies"
  bun install --frozen-lockfile
else
  log "node_modules present; skipping install"
fi

# 3. Built output for @wystack/* — @dashframe/* imports resolve against dist.
#    turbo caches this, so re-running on an already-built tree is cheap.
log "building vendored @wystack/* packages"
bun run build:wystack

# 4. Pinned local Convex backend. Needed only to run the app, not for
#    lint/typecheck/test, so a download failure must not fail the session.
#    The provisioner is a no-op when the verified binary is already cached.
log "provisioning local Convex backend"
if ! bun --filter @dashframe/convex-local provision; then
  log "WARNING: Convex provision failed; lint/test still work, running the app will not"
fi

# 5. Session environment. The cloud VM has a single checkout, so the
#    .husky/pre-commit worktree guard must be bypassed here (see AGENTS.md
#    -> Worktrees); the VM itself provides the isolation.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export ALLOW_MAIN_CHECKOUT_COMMIT=1' >> "$CLAUDE_ENV_FILE"
fi

log "done"
