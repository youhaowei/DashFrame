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
#     ~/worktrees/<project>/<branch> via `git worktree add`, which populates
#     <branch-name> in the *new* worktree only, and prints the new path.  The
#     caller must cd into that path.  The main checkout's HEAD and current
#     branch are never switched — verified by an assertion before this
#     script hands back control.
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

# assert_main_checkout_unchanged <repo_root> <head_before> <branch_before>
# Fail closed if provisioning the new worktree mutated the main checkout's
# HEAD or current branch out from under whoever else is using it.
assert_main_checkout_unchanged() {
  _amcu_repo_root="$1"
  _amcu_head_before="$2"
  _amcu_branch_before="$3"
  _amcu_head_after=$(git -C "$_amcu_repo_root" rev-parse HEAD 2>/dev/null || echo "")
  _amcu_branch_after=$(git -C "$_amcu_repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  if [ "$_amcu_head_after" != "$_amcu_head_before" ] || [ "$_amcu_branch_after" != "$_amcu_branch_before" ]; then
    echo "ERROR [ensure-worktree]: main checkout at '$_amcu_repo_root' was mutated while provisioning the worktree." >&2
    echo "  Before: HEAD=$_amcu_head_before branch=$_amcu_branch_before" >&2
    echo "  After:  HEAD=$_amcu_head_after branch=$_amcu_branch_after" >&2
    echo "  This should never happen — refusing to hand back a worktree path." >&2
    exit 1
  fi
}

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
  # Already in an isolated worktree — verify branch matches.
  current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "HEAD")
  if [ "$current_branch" != "$branch" ] && [ "$current_branch" != "HEAD" ]; then
    echo "ERROR [ensure-worktree]: already in a worktree on '$current_branch', expected '$branch'." >&2
    echo "  Switch to the correct worktree for '$branch' or run from the default branch." >&2
    exit 1
  fi
  # Print the worktree root for the caller to cd into (in case they're in a subdir).
  git rev-parse --show-toplevel
  exit 0
fi

# ── 3. We're in the main checkout — provision a new worktree ────────────────
# Snapshot the main checkout's HEAD + current branch so we can assert, right
# before we hand control back to the caller, that provisioning the new
# worktree never mutated the main checkout itself (see assertion at the
# bottom of this branch).
main_head_before=$(git rev-parse HEAD 2>/dev/null || echo "")
main_branch_before=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

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
  # Verify the existing directory is a worktree of *this* repo (shares git-common-dir).
  wt_common_dir=$(git -C "$worktree_path" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
  if [ "$wt_common_dir" != "$git_common_dir" ]; then
    echo "ERROR [ensure-worktree]: '$worktree_path' belongs to a different repository." >&2
    echo "  Expected: $git_common_dir" >&2
    echo "  Found:    $wt_common_dir" >&2
    exit 1
  fi
  if [ "$existing_branch" != "$branch" ] && [ "$existing_branch" != "HEAD" ]; then
    echo "ERROR [ensure-worktree]: '$worktree_path' exists but is on '$existing_branch', not '$branch'." >&2
    echo "  Remove it manually ('git worktree remove $worktree_path') or choose a different base." >&2
    exit 1
  fi
  assert_main_checkout_unchanged "$repo_root" "$main_head_before" "$main_branch_before"
  echo "$worktree_path"
  exit 0
fi

# Create the worktree.  If the branch already exists locally, use it; otherwise
# track from origin.
mkdir -p "$worktree_base"

# Run git worktree add; redirect BOTH stdout and stderr to a temp log so the
# only thing this script writes to stdout is the final worktree path.
# Use `|| _wt_rc=$?` (not `; _wt_rc=$?`) to capture the exit code under
# set -e: with `set -e`, a bare semicolon sequence exits immediately on
# failure before the assignment runs.
_wt_log=$(mktemp)
_wt_rc=0
if git show-ref --verify --quiet "refs/heads/$branch"; then
  git worktree add "$worktree_path" "$branch" >"$_wt_log" 2>&1 || _wt_rc=$?
else
  # Check whether the branch exists on origin. `git ls-remote --exit-code`
  # only guarantees exit code 2 for "no matching refs" — other non-zero
  # exits (network down, auth failure, etc.) mean the lookup itself failed,
  # not that the branch is confirmed absent. Distinguish the two so a
  # transient remote failure can't be misread as "brand new branch" and
  # silently branch from main instead.
  _ls_remote_rc=0
  git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1 || _ls_remote_rc=$?
  if [ "$_ls_remote_rc" -eq 0 ]; then
    # Fetch to ensure the local remote-tracking ref exists — ls-remote verifies the
    # branch on the network but git worktree add resolves against the local
    # refs/remotes/origin/<branch> ref, which only exists after a fetch.
    git fetch origin "$branch" >/dev/null 2>&1 || true
    git worktree add "$worktree_path" -b "$branch" "origin/$branch" >"$_wt_log" 2>&1 || _wt_rc=$?
  elif [ "$_ls_remote_rc" -ne 2 ]; then
    echo "ERROR [ensure-worktree]: could not determine whether branch '$branch' exists on origin (git ls-remote exited $_ls_remote_rc)." >&2
    echo "  This looks like a network or auth problem reaching 'origin', not a missing branch — not falling back to branching from main." >&2
    exit 1
  else
    # Brand-new branch (ls-remote confirmed no matching ref, exit 2): create
    # it AND the worktree in one atomic command, rooted at a fresh
    # origin/main, with tracking disabled so the new branch's upstream isn't
    # main. This never touches the main checkout's HEAD or current branch —
    # unlike instructing the caller to run `git checkout -b <branch>` in the
    # main checkout (the historical behaviour here), which yanks the branch
    # out from under whoever else is using that checkout.
    git fetch origin main >/dev/null 2>&1 || true
    if ! git show-ref --verify --quiet "refs/remotes/origin/main"; then
      rm -f "$_wt_log"
      echo "ERROR [ensure-worktree]: branch '$branch' not found locally or on origin, and 'origin/main' is unavailable to branch from." >&2
      exit 1
    fi
    git worktree add --no-track -b "$branch" "$worktree_path" origin/main >"$_wt_log" 2>&1 || _wt_rc=$?
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

assert_main_checkout_unchanged "$repo_root" "$main_head_before" "$main_branch_before"

echo "$worktree_path"
