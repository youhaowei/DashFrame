#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Brings a fresh cloud checkout to the state `bun run setup` produces locally:
# submodules initialized, workspace dependencies installed, the vendored
# @wystack/* packages built, and the pinned local Convex backend provisioned.
# Runs only in remote (web) sessions; a local checkout is left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

log() { echo "[session-start] $*" >&2; }

if ! command -v bun >/dev/null 2>&1; then
  log "bun not found on PATH; installing"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
log "bun $(bun --version)"

# 1. Submodules (libs/wystack, libs/stdui). Nothing else syncs them.
log "initializing submodules"
git submodule update --init --recursive

# 2. Workspace dependencies. Plain `bun install` so the cached container
#    reuses node_modules on later sessions; the lockfile is honored as-is.
log "installing dependencies"
bun install --frozen-lockfile

# 3. Built output for @wystack/* — @dashframe/* imports resolve against dist.
log "building vendored @wystack/* packages"
bun run build:wystack

# 4. Pinned local Convex backend. Needed only to run the app, not for
#    lint/typecheck/test, so a download failure must not fail the session.
log "provisioning local Convex backend"
if ! bun --filter @dashframe/convex-local provision; then
  log "WARNING: Convex provision failed; lint/test still work, running the app will not"
fi

# 5. Session environment. The cloud VM has a single checkout, so the
#    .husky/pre-commit worktree guard must be bypassed here (see AGENTS.md
#    -> Worktrees); the VM itself provides the isolation.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export ALLOW_MAIN_CHECKOUT_COMMIT=1'
    echo 'export PATH="$HOME/.bun/bin:$PATH"'
  } >> "$CLAUDE_ENV_FILE"
fi

log "done"
