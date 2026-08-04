#!/usr/bin/env bash
# Remove a git worktree that contains populated submodules.
#
# `git worktree remove` refuses whenever submodules are populated, so plain
# removal always appears to need --force. This wrapper does the safety check
# git skips — it refuses only when a submodule has uncommitted changes or
# commits that exist nowhere upstream — and then forces the removal.
#
# usage: scripts/remove-worktree.sh <worktree-path>
set -euo pipefail

worktree_path="${1:-}"
[ -n "$worktree_path" ] || { echo "usage: remove-worktree.sh <worktree-path>" >&2; exit 2; }
[ -d "$worktree_path" ] || { echo "remove-worktree: no such directory: $worktree_path" >&2; exit 1; }

blocked=false
if [ -f "$worktree_path/.gitmodules" ]; then
  for sub in $(git config --file "$worktree_path/.gitmodules" --get-regexp 'submodule\..*\.path' | awk '{print $2}'); do
    subdir="$worktree_path/$sub"
    [ -e "$subdir/.git" ] || continue
    if [ -n "$(git -C "$subdir" status --porcelain 2>/dev/null)" ]; then
      echo "remove-worktree: $sub has uncommitted changes" >&2
      blocked=true
    fi
    # Commits not on any remote-tracking ref would be lost with the checkout.
    unpushed=$(git -C "$subdir" log --branches --not --remotes --oneline 2>/dev/null | head -5)
    if [ -n "$unpushed" ]; then
      echo "remove-worktree: $sub has commits not pushed to any remote:" >&2
      printf '%s\n' "$unpushed" | sed 's/^/    /' >&2
      blocked=true
    fi
  done
fi
if [ "$blocked" = true ]; then
  echo "remove-worktree: refusing — push or discard the library work above first." >&2
  exit 1
fi

git worktree remove --force "$worktree_path"
echo "remove-worktree: removed $worktree_path"
