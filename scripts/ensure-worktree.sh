#!/usr/bin/env sh
# ensure-worktree.sh — bootstrap isolation for dispatched agents
#
# USAGE:
#   scripts/ensure-worktree.sh <branch-name>
#
# What it does:
#   - Verifies the caller is already in an isolated worktree (not the main
#     checkout).  If so, prints the worktree path and exits 0.
#   - If the caller IS in the main checkout, creates a new worktree at
#     ~/worktrees/<project>/<branch>, checks out <branch-name> there, and
#     prints the new path.  The caller must cd into that path.
#   - Hard-fails (exit 1) if anything goes wrong — this is fail-closed by
#     design so that a briefed agent cannot silently proceed in main.
#
# ENV:
#   WORKTREE_BASE  Override the base directory (default: ~/worktrees/<project>)
#
# NOTE: this script CANNOT cd for the caller — subprocess cd is not visible to
# the parent shell.  The caller must:
#   worktree=$(scripts/ensure-worktree.sh <branch>)
#   cd "$worktree"
# or, in a brief: "Run scripts/ensure-worktree.sh <branch>; cd into the path it prints."

set -eu

# ── 1. Require a branch argument ────────────────────────────────────────────
branch="${1:-}"
if [ -z "$branch" ]; then
  echo "ERROR [ensure-worktree]: a branch name is required." >&2
  echo "  Usage: scripts/ensure-worktree.sh <branch-name>" >&2
  exit 1
fi

# ── 2. Detect whether we are in the main checkout or already in a worktree ──
# git --git-dir  == git --git-common-dir  → main checkout
# git --git-dir  != git --git-common-dir  → linked worktree
git_dir=$(git rev-parse --path-format=absolute --git-dir 2>/dev/null) || {
  echo "ERROR [ensure-worktree]: not inside a git repository." >&2
  exit 1
}
git_common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || {
  echo "ERROR [ensure-worktree]: cannot determine git-common-dir." >&2
  exit 1
}

if [ "$git_dir" != "$git_common_dir" ]; then
  # Already in an isolated worktree — verify branch matches and we're clean.
  current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "HEAD")
  if [ "$current_branch" != "$branch" ] && [ "$current_branch" != "HEAD" ]; then
    echo "WARNING [ensure-worktree]: worktree is on '$current_branch', expected '$branch'." >&2
    # Soft warning only; the caller can still proceed — it's isolated regardless.
  fi
  # Print the worktree root for the caller to cd into (in case they're in a subdir).
  git rev-parse --show-toplevel
  exit 0
fi

# ── 3. We're in the main checkout — provision a new worktree ────────────────
repo_root=$(git rev-parse --show-toplevel)
# Lowercase the project name so the canonical worktree base is always
# ~/worktrees/<lower-project>/<branch> regardless of how the repo dir is
# capitalised on disk (e.g. DashFrame → dashframe).
project_name=$(basename "$repo_root" | tr '[:upper:]' '[:lower:]')

# Base dir: WORKTREE_BASE env override or ~/worktrees/<project>
worktree_base="${WORKTREE_BASE:-$HOME/worktrees/$project_name}"

# Sanitise branch name for use as a directory component.
# Replace forward-slashes and colons with dashes; lowercase.
dir_slug=$(printf '%s' "$branch" | tr '/:' '-' | tr '[:upper:]' '[:lower:]')
worktree_path="$worktree_base/$dir_slug"

if [ -d "$worktree_path" ]; then
  # Worktree directory already exists.  Verify it belongs to this repo and is
  # on the expected branch before re-using it.
  existing_branch=$(git -C "$worktree_path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  if [ -z "$existing_branch" ]; then
    echo "ERROR [ensure-worktree]: '$worktree_path' exists but is not a valid git checkout." >&2
    exit 1
  fi
  if [ "$existing_branch" != "$branch" ] && [ "$existing_branch" != "HEAD" ]; then
    echo "ERROR [ensure-worktree]: '$worktree_path' exists but is on '$existing_branch', not '$branch'." >&2
    echo "  Remove it manually ('git worktree remove $worktree_path') or choose a different base." >&2
    exit 1
  fi
  echo "$worktree_path"
  exit 0
fi

# Create the worktree.  If the branch already exists locally, use it; otherwise
# track from origin.
mkdir -p "$worktree_base"

# Run git worktree add; redirect BOTH stdout and stderr to a temp log so the
# only thing this script writes to stdout is the final worktree path.
# Check $? directly (not through a pipe) to preserve the exit status.
_wt_log=$(mktemp)
if git show-ref --verify --quiet "refs/heads/$branch"; then
  git worktree add "$worktree_path" "$branch" >"$_wt_log" 2>&1; _wt_rc=$?
else
  # Try to track from origin; error out if the branch doesn't exist anywhere.
  if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
    git worktree add "$worktree_path" -b "$branch" "origin/$branch" >"$_wt_log" 2>&1; _wt_rc=$?
  else
    rm -f "$_wt_log"
    echo "ERROR [ensure-worktree]: branch '$branch' not found locally or on origin." >&2
    echo "  Create it first: git checkout -b $branch" >&2
    exit 1
  fi
fi
if [ "$_wt_rc" -ne 0 ]; then
  sed 's/^/[ensure-worktree] /' "$_wt_log" >&2
  rm -f "$_wt_log"
  echo "ERROR [ensure-worktree]: git worktree add failed (exit $_wt_rc)." >&2
  exit 1
fi
# On success, forward git's informational output to stderr (not stdout).
sed 's/^/[ensure-worktree] /' "$_wt_log" >&2
rm -f "$_wt_log"

# Confirm the worktree was created and is in the right state.
if [ ! -d "$worktree_path" ]; then
  echo "ERROR [ensure-worktree]: worktree creation reported success but '$worktree_path' does not exist." >&2
  exit 1
fi

actual_branch=$(git -C "$worktree_path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ "$actual_branch" != "$branch" ]; then
  echo "ERROR [ensure-worktree]: worktree created but is on '$actual_branch' instead of '$branch'." >&2
  exit 1
fi

echo "$worktree_path"
