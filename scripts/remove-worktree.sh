#!/usr/bin/env bash
# Remove a git worktree that contains populated submodules.
#
# `git worktree remove` refuses whenever submodules are populated, so plain
# removal always appears to need --force. This wrapper does the safety checks
# git skips, then forces the removal. It refuses when:
#   - the worktree itself has uncommitted or untracked files, or
#   - a submodule has uncommitted changes, or
#   - a submodule has commits unreachable from any remote-tracking ref
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
# them — so do that check here first.
if ! wt_status=$(git -C "$worktree_path" status --porcelain 2>&1); then
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
    # HEAD + local branches (not --all: that sweeps in upstream archive tags
    # and blocks pristine worktrees), checked against remote-tracking refs
    # AND tags — anything reachable from either exists upstream. Detached
    # HEAD commits and local branches die with the per-worktree gitdir.
    # No pipe into a truncating command — head's early exit would SIGPIPE
    # git under pipefail; capture fully, truncate for display afterwards.
    if ! unpushed=$(git -C "$subdir" log HEAD --branches --not --remotes --tags --oneline 2>&1); then
      echo "remove-worktree: cannot enumerate submodule commits for $sub: $unpushed" >&2
      exit 1
    fi
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
