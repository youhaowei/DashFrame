#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Brings a fresh cloud checkout to the state `bun run setup` produces locally:
# submodules initialized, workspace dependencies installed, the vendored
# @wystack/* packages built, and the pinned local Convex backend provisioned.
# Runs only in remote (web) sessions; a local checkout is left alone.
#
# Each provisioning step is skipped once its output is verifiably complete,
# so a resumed session never moves a submodule off a parked branch or
# re-resolves a `bun link` (AGENTS.md -> Worktrees: install once per
# checkout, and nothing syncs submodules automatically). A step that was
# interrupted part-way is detected and repaired on the next run.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

log() { echo "[session-start] $*" >&2; }

# Session environment, written first so it survives a failure below. The
# cloud VM has a single checkout, so the .husky/pre-commit worktree guard
# must be bypassed here (AGENTS.md -> Worktrees); the VM itself provides the
# isolation. If bootstrap fails, the session still needs to be able to
# commit a fix.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export ALLOW_MAIN_CHECKOUT_COMMIT=1' >> "$CLAUDE_ENV_FILE"
fi

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

# 1. Submodules (libs/wystack, libs/stdui). Same health gate as
#    scripts/ensure-worktree.sh: a checkout counts as populated only when
#    HEAD resolves AND at least one file HEAD records exists on disk. A bare
#    gitfile or a resolvable HEAD over an empty tree (init interrupted
#    between clone and checkout) is not enough. Populated checkouts, on any
#    branch and dirty or not, are never touched. A half-initialized one
#    needs --force, because a plain update is a no-op when HEAD already
#    matches the recorded sha.
submodule_populated() {
  [ -e "$1/.git" ] || return 1
  git -C "$1" rev-parse --verify --quiet HEAD >/dev/null 2>&1 || return 1
  git -C "$1" ls-tree -r --name-only HEAD 2>/dev/null | while IFS= read -r f; do
    if [ -e "$1/$f" ] || [ -L "$1/$f" ]; then
      echo yes
      break
    fi
  done | grep -q yes
}
for sub in $(git config --file .gitmodules --get-regexp 'submodule\..*\.path' | awk '{print $2}'); do
  if submodule_populated "$sub"; then
    log "submodule $sub populated; leaving checkout untouched"
    continue
  fi
  force=""
  [ -e "$sub/.git" ] && force="--force"
  log "initializing submodule $sub${force:+ (repairing interrupted checkout)}"
  # shellcheck disable=SC2086
  git submodule update --init --recursive $force -- "$sub"
done

# 2. Workspace dependencies, once per checkout with the lockfile honored
#    as-is. `node_modules` existing is not proof of success (an interrupted
#    install leaves a partial tree), so completion is recorded in a marker
#    written only after the install exits 0. The marker lives inside
#    node_modules so it is gitignored and disappears with a clean.
install_marker=node_modules/.session-start-installed
if [ -f "$install_marker" ]; then
  log "dependencies installed (marker present); skipping install"
else
  log "installing dependencies"
  bun install --frozen-lockfile
  : > "$install_marker"
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

log "done"
