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
#     reachable from anything its remotes have (the submodule gitdir is
#     per-worktree, so removal destroys detached-HEAD commits, stashes,
#     local branches, and local tags alike), or
#   - no remote can be reached to verify which refs are pushed.
#
# Pushed-ness is decided against `git ls-remote`, not local guesswork:
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

# check_submodule_refs <label> <git...> — refuse when the submodule holds
# commits no remote has, or stashes. The git invocation prefix is either
# `git -C <checkout>` or `git --git-dir <module-gitdir>` so the same checks
# run whether or not a checkout exists on disk.
check_submodule_refs() {
  local sub="$1"; shift
  local remotes remote remote_refs sha ref unpushed stashes reached=false
  local pushed=()

  # The remote name is whatever this submodule actually has — never assume
  # `origin`; a renamed remote must not read as an unreachable one.
  if ! remotes=$("$@" remote 2>&1); then
    echo "remove-worktree: cannot list remotes for $sub: $remotes" >&2
    exit 1
  fi
  if [ -z "$remotes" ]; then
    echo "remove-worktree: $sub has no remote — nothing in it can be verified as pushed." >&2
    blocked=true
    return 0
  fi

  # What the remotes actually have, fresh — remote-tracking refs alone miss
  # tags entirely. Fail closed only when NO remote answers: guessing while
  # offline is how work gets lost.
  local remote_errors=""
  for remote in $remotes; do
    if remote_refs=$("$@" ls-remote --heads --tags "$remote" 2>/dev/null); then
      reached=true
      while read -r sha ref; do
        [ -n "$sha" ] || continue
        # Only objects that exist locally can be used as exclusions; a
        # remote sha never fetched cannot be an ancestor of local refs.
        if "$@" cat-file -e "$sha" 2>/dev/null; then
          pushed+=("$sha")
        fi
      done <<EOF
$remote_refs
EOF
    else
      # Keep git's own reason — a bad URL, an expired credential, and a DNS
      # outage must not all collapse into one indistinguishable line. This
      # repeats the call, but only on a path that already failed and exits.
      remote_errors="$remote_errors
    $remote: $("$@" ls-remote --heads --tags "$remote" 2>&1 >/dev/null | sed -n '1p' || true)"
    fi
  done
  if [ "$reached" = false ]; then
    echo "remove-worktree: cannot reach any remote to verify pushed refs for $sub:$remote_errors" >&2
    exit 1
  fi

  # Everything local — HEAD, branches, and tags — minus everything the
  # remotes have. --remotes stays as a second exclusion source so commits
  # pushed before a remote moved on are still recognized. Note: after --not,
  # revs are negated WITHOUT a ^ prefix (a ^ there would flip them back to
  # included). No pipe into a truncating command — head's early exit would
  # SIGPIPE git under pipefail; capture fully, truncate for display after.
  if ! unpushed=$("$@" log --oneline HEAD --branches --tags --not --remotes ${pushed[@]+"${pushed[@]}"} -- 2>&1); then
    echo "remove-worktree: cannot enumerate submodule commits for $sub: $unpushed" >&2
    exit 1
  fi
  if [ -n "$unpushed" ]; then
    echo "remove-worktree: $sub has commits no remote has:" >&2
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

# Pass 1 — checkout state, enumerated from HEAD's tree (gitlink entries):
# uncommitted changes, pointer drift, and gitlink paths holding content that
# is not a submodule checkout. Ref checks happen in pass 2, keyed on the
# gitdirs themselves.
while IFS= read -r -d '' entry; do
  mode="${entry%% *}"
  [ "$mode" = "160000" ] || continue
  sub="${entry#*$'\t'}"
  subdir="$worktree_path/$sub"

  if [ -e "$subdir/.git" ]; then
    # Populated checkout: uncommitted changes, then pointer drift.
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
    # A .git DIRECTORY (not the gitfile `git submodule update` writes) means
    # the gitdir is embedded in the checkout — e.g. a hand-run `git clone`
    # into the path. Pass 2 never sees it (it only walks <gitdir>/modules),
    # so its refs and stashes are checked here.
    if [ -d "$subdir/.git" ]; then
      check_submodule_refs "$sub" git -C "$subdir"
    fi
  elif [ -d "$subdir" ] && [ -z "$(ls -A "$subdir")" ]; then
    # The empty placeholder directory git materializes at every
    # uninitialized gitlink path — benign, nothing to lose.
    :
  elif [ -e "$subdir" ]; then
    # Content at a gitlink path that is not a submodule checkout would be
    # silently discarded by the removal (--ignore-submodules=all hides it).
    echo "remove-worktree: $sub was replaced by non-submodule content — inspect or remove it first." >&2
    blocked=true
  fi
done < <(git -C "$worktree_path" ls-tree -r -z HEAD)

# Pass 2 — refs and stashes, enumerated from the per-worktree gitdirs that
# actually exist on disk under <gitdir>/modules, NOT from HEAD's tree or
# .gitmodules: removal destroys these directories regardless of whether
# their gitlink is still in HEAD (a submodule deleted from the branch keeps
# its gitdir) or of what path it sits at (git keys modules/ by submodule
# NAME, which diverges from the path after `git mv`). Nested submodules
# appear as gitdirs under a parent's modules/ and are found the same way.
if [ -d "$wt_gitdir/modules" ]; then
  while IFS= read -r -d '' cfg; do
    module_gitdir="${cfg%/config}"
    [ -f "$module_gitdir/HEAD" ] || continue
    # Every git call against a module gitdir needs --work-tree pointed at a
    # directory that exists: core.worktree in the gitdir may reference a
    # deleted checkout and git dies on chdir before doing anything —
    # including this sanity check, which would otherwise silently skip
    # exactly the deleted-checkout gitdirs pass 2 exists to protect.
    git --git-dir "$module_gitdir" --work-tree "$worktree_path" rev-parse --git-dir >/dev/null 2>&1 || continue
    # Label by the gitdir's name under modules/ — the path may no longer
    # exist; none of these checks read the worktree.
    check_submodule_refs "${module_gitdir#"$wt_gitdir/modules/"}" \
      git --git-dir "$module_gitdir" --work-tree "$worktree_path"
  done < <(find "$wt_gitdir/modules" -name config -type f -print0 2>/dev/null)
fi

if [ "$blocked" = true ]; then
  echo "remove-worktree: refusing — push or discard the work above first." >&2
  exit 1
fi

git -C "$worktree_path" worktree remove --force "$worktree_path"
echo "remove-worktree: removed $worktree_path"
