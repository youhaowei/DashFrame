#!/usr/bin/env bash
# Remove a git worktree that contains populated submodules.
#
# `git worktree remove` refuses whenever submodules are populated, so plain
# removal always appears to need --force. This wrapper does the safety checks
# git skips, then forces the removal. It refuses when:
#   - the worktree itself has uncommitted or untracked files, or
#   - a submodule checkout differs from the commit the branch records
#     (a stale checkout to sync, or an uncommitted pointer bump), or
#   - a submodule has uncommitted changes, or
#   - a submodule has commits that exist nowhere upstream
#     (this includes detached-HEAD commits, stashes, and local branches —
#     the submodule gitdir is per-worktree, so removal destroys them all).
#
# usage: scripts/remove-worktree.sh <worktree-path>
set -euo pipefail

worktree_path="${1:-}"
[ -n "$worktree_path" ] || { echo "usage: remove-worktree.sh <worktree-path>" >&2; exit 2; }
[ -d "$worktree_path" ] || { echo "remove-worktree: no such directory: $worktree_path" >&2; exit 1; }

blocked=false

# The superproject worktree itself: plain `git worktree remove` would refuse
# on modified or untracked files, and --force below would silently discard
# them — so do that check here first. Submodules are excluded entirely: a
# gitlink difference is not an uncommitted file (ignore = dirty hides dirty
# submodule worktrees but never pointer moves, so it would show up here and
# block lossless worktrees with a message whose remedies cannot clear it).
# Pointer differences get their own check, with the right remedies, below.
if ! wt_status=$(git -C "$worktree_path" status --porcelain --ignore-submodules=all 2>&1); then
  echo "remove-worktree: cannot read worktree state: $wt_status" >&2
  exit 1
fi
if [ -n "$wt_status" ]; then
  echo "remove-worktree: worktree has uncommitted or untracked files:" >&2
  printf '%s\n' "$wt_status" | sed -n '1,5p' | sed 's/^/    /' >&2
  blocked=true
fi

if [ -f "$worktree_path/.gitmodules" ]; then
  for sub in $(git config --file "$worktree_path/.gitmodules" --get-regexp 'submodule\..*\.path' | awk '{print $2}'); do
    subdir="$worktree_path/$sub"
    [ -e "$subdir/.git" ] || continue
    if ! sub_status=$(git -C "$subdir" status --porcelain 2>&1); then
      echo "remove-worktree: cannot read submodule state for $sub: $sub_status" >&2
      exit 1
    fi
    if [ -n "$sub_status" ]; then
      echo "remove-worktree: $sub has uncommitted changes" >&2
      blocked=true
    fi
    # The submodule checkout vs the commit this branch records: a difference
    # is either a stale checkout after a branch switch (lossless) or a pointer
    # bump not yet committed. Both deserve a block with the actual way out —
    # `git stash` / `git checkout -- .` cannot clear a gitlink difference.
    if ! recorded=$(git -C "$worktree_path" rev-parse "HEAD:$sub" 2>&1); then
      echo "remove-worktree: cannot read recorded commit for $sub: $recorded" >&2
      exit 1
    fi
    if ! checked_out=$(git -C "$subdir" rev-parse HEAD 2>&1); then
      echo "remove-worktree: cannot read checked-out commit for $sub: $checked_out" >&2
      exit 1
    fi
    if [ "$recorded" != "$checked_out" ]; then
      echo "remove-worktree: $sub is checked out at ${checked_out:0:12}, but the branch records ${recorded:0:12}." >&2
      echo "    Stale checkout: sync it with 'git submodule update -- $sub'." >&2
      echo "    Pointer bump you meant to keep: commit it in the superproject first." >&2
      blocked=true
    fi
    # Unpushed work, in two halves (not --all: that sweeps in upstream tags,
    # which --remotes does not cover — remote-tracking refs are branches only —
    # and blocks pristine worktrees). HEAD is checked against remote branches
    # AND tags, because a detached HEAD legitimately sits on a pushed tag or
    # release; local branches are checked against remote branches only, so a
    # local-only tag can never make unpushed branch work look pushed.
    # Residual: a commit reachable ONLY from a local tag, with no branch on it
    # and HEAD moved away, still slips through — only --all would catch it,
    # and --all reintroduces the pushed-tag false positive.
    # No pipe into a truncating command — head's early exit would SIGPIPE
    # git under pipefail; capture fully, truncate for display afterwards.
    if ! unpushed_head=$(git -C "$subdir" log HEAD --not --remotes --tags --oneline 2>&1); then
      echo "remove-worktree: cannot enumerate submodule HEAD commits for $sub: $unpushed_head" >&2
      exit 1
    fi
    if ! unpushed_branches=$(git -C "$subdir" log --branches --not --remotes --oneline 2>&1); then
      echo "remove-worktree: cannot enumerate submodule branch commits for $sub: $unpushed_branches" >&2
      exit 1
    fi
    unpushed=$(printf '%s\n%s\n' "$unpushed_head" "$unpushed_branches" | sort -u | sed '/^$/d')
    if [ -n "$unpushed" ]; then
      echo "remove-worktree: $sub has commits not pushed to any remote:" >&2
      printf '%s\n' "$unpushed" | sed -n '1,5p' | sed 's/^/    /' >&2
      blocked=true
    fi
    # Stashes are per-gitdir too and invisible to git log's ref selectors.
    if ! stashes=$(git -C "$subdir" stash list 2>&1); then
      echo "remove-worktree: cannot read stash list for $sub: $stashes" >&2
      exit 1
    fi
    if [ -n "$stashes" ]; then
      echo "remove-worktree: $sub has stashed changes:" >&2
      printf '%s\n' "$stashes" | sed -n '1,5p' | sed 's/^/    /' >&2
      blocked=true
    fi
  done
fi

if [ "$blocked" = true ]; then
  echo "remove-worktree: refusing — push or discard the work above first." >&2
  exit 1
fi

git worktree remove --force "$worktree_path"
echo "remove-worktree: removed $worktree_path"
