#!/usr/bin/env bash
# Remove a git worktree that contains populated submodules.
#
# `git worktree remove` refuses whenever submodules are populated, so plain
# removal always appears to need --force. This wrapper does the safety checks
# git skips, then forces the removal. It refuses when:
#   - the worktree itself has uncommitted or untracked files, or
#   - a submodule checkout differs from the commit the branch records
#     (a stale checkout to sync, or an uncommitted pointer bump), or
#   - a submodule path was deleted or replaced by other content while its
#     per-worktree gitdir still exists, or
#   - a submodule has uncommitted changes, stashes, or commits that are not
#     reachable from anything origin has (the submodule gitdir is
#     per-worktree, so removal destroys detached-HEAD commits, stashes,
#     local branches, and local tags alike), or
#   - origin cannot be reached to verify which refs are pushed.
#
# Pushed-ness is decided against `git ls-remote origin`, not local guesswork:
# local refs cannot tell a pushed tag from a local-only one, and every purely
# local formulation of this check had a counterexample — either destroying
# work hidden behind a local tag or blocking work published only via a tag.
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
# gitlink difference is not an uncommitted file, and every submodule state
# gets its own dedicated check below, with remedies that actually work.
if ! wt_status=$(git -C "$worktree_path" status --porcelain --ignore-submodules=all 2>&1); then
  echo "remove-worktree: cannot read worktree state: $wt_status" >&2
  exit 1
fi
if [ -n "$wt_status" ]; then
  echo "remove-worktree: worktree has uncommitted or untracked files:" >&2
  printf '%s\n' "$wt_status" | sed -n '1,5p' | sed 's/^/    /' >&2
  blocked=true
fi

if ! wt_gitdir=$(git -C "$worktree_path" rev-parse --absolute-git-dir 2>&1); then
  echo "remove-worktree: cannot resolve worktree gitdir: $wt_gitdir" >&2
  exit 1
fi

# check_submodule_refs <sub-path> <git...> — refuse when the submodule holds
# commits origin does not have, or stashes. The git invocation prefix is
# either `git -C <checkout>` or `git --git-dir <module-gitdir>` so the same
# checks run whether or not a checkout exists on disk.
check_submodule_refs() {
  local sub="$1"; shift
  local remote_refs sha ref unpushed stashes
  local pushed=()

  # What origin actually has, fresh — remote-tracking refs alone miss tags
  # entirely. Fail closed: guessing while offline is how work gets lost.
  if ! remote_refs=$("$@" ls-remote --heads --tags origin 2>&1); then
    echo "remove-worktree: cannot reach origin to verify pushed refs for $sub:" >&2
    printf '%s\n' "$remote_refs" | sed -n '1,3p' | sed 's/^/    /' >&2
    exit 1
  fi
  while read -r sha ref; do
    [ -n "$sha" ] || continue
    # Only objects that exist locally can be used as exclusions; a remote sha
    # we never fetched cannot be an ancestor of anything local anyway.
    if "$@" cat-file -e "$sha" 2>/dev/null; then
      pushed+=("$sha")
    fi
  done <<EOF
$remote_refs
EOF

  # Everything local — HEAD, branches, and tags — minus everything origin
  # has. --remotes stays as a second exclusion source so commits pushed
  # before origin moved on are still recognized. Note: after --not, revs are
  # negated WITHOUT a ^ prefix (a ^ there would flip them back to included).
  # No pipe into a truncating command — head's early exit would SIGPIPE git
  # under pipefail; capture fully, truncate for display afterwards.
  if ! unpushed=$("$@" log --oneline HEAD --branches --tags --not --remotes ${pushed[@]+"${pushed[@]}"} -- 2>&1); then
    echo "remove-worktree: cannot enumerate submodule commits for $sub: $unpushed" >&2
    exit 1
  fi
  if [ -n "$unpushed" ]; then
    echo "remove-worktree: $sub has commits origin does not have:" >&2
    printf '%s\n' "$unpushed" | sed -n '1,5p' | sed 's/^/    /' >&2
    blocked=true
  fi

  # Stashes are per-gitdir too and invisible to git log's ref selectors.
  if ! stashes=$("$@" stash list 2>&1); then
    echo "remove-worktree: cannot read stash list for $sub: $stashes" >&2
    exit 1
  fi
  if [ -n "$stashes" ]; then
    echo "remove-worktree: $sub has stashed changes:" >&2
    printf '%s\n' "$stashes" | sed -n '1,5p' | sed 's/^/    /' >&2
    blocked=true
  fi
}

# Enumerate submodules from HEAD's tree (gitlink entries), not from what is
# on disk — a deleted or replaced checkout must not exempt its gitdir, which
# is what removal actually destroys.
while IFS= read -r -d '' entry; do
  mode="${entry%% *}"
  [ "$mode" = "160000" ] || continue
  sub="${entry#*$'\t'}"
  subdir="$worktree_path/$sub"
  module_gitdir="$wt_gitdir/modules/$sub"

  if [ -e "$subdir/.git" ]; then
    # Populated checkout: uncommitted changes, pointer drift, then refs.
    if ! sub_status=$(git -C "$subdir" status --porcelain 2>&1); then
      echo "remove-worktree: cannot read submodule state for $sub: $sub_status" >&2
      exit 1
    fi
    if [ -n "$sub_status" ]; then
      echo "remove-worktree: $sub has uncommitted changes" >&2
      blocked=true
    fi
    # A checkout that differs from the commit this branch records is either
    # a stale checkout after a branch switch (lossless) or a pointer bump
    # not yet committed. Both deserve a block with the actual way out —
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
    check_submodule_refs "$sub" git -C "$subdir"
  elif [ -d "$module_gitdir" ]; then
    # The checkout is gone (or replaced by other content) but the gitdir —
    # the part removal destroys — is still here. Check its refs directly,
    # and refuse stray content at the path outright.
    if [ -e "$subdir" ]; then
      echo "remove-worktree: $sub was replaced by non-submodule content — inspect or remove it first." >&2
      blocked=true
    fi
    # The module gitdir's core.worktree points at the deleted checkout, so
    # git would die on chdir before running anything; point it at a
    # directory that exists — none of these checks read the worktree.
    check_submodule_refs "$sub" git --git-dir "$module_gitdir" --work-tree "$worktree_path"
  fi
  # No checkout and no gitdir: never initialized here, nothing to lose.
done < <(git -C "$worktree_path" ls-tree -r -z HEAD)

if [ "$blocked" = true ]; then
  echo "remove-worktree: refusing — push or discard the work above first." >&2
  exit 1
fi

git -C "$worktree_path" worktree remove --force "$worktree_path"
echo "remove-worktree: removed $worktree_path"
