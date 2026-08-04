#!/usr/bin/env bash
# Remove a git worktree that contains populated submodules.
#
# `git worktree remove` refuses whenever submodules are populated, so plain
# removal always appears to need --force. This wrapper does the safety checks
# git skips, then forces the removal. It refuses when:
#   - the worktree itself has uncommitted or untracked files, or
#   - the worktree's own per-worktree gitdir holds commits reachable from no
#     branch, tag, or remote ref (a detached-HEAD commit dies with that
#     gitdir), or an operation is paused there (rebase, bisect, merge,
#     cherry-pick, revert — all keep their state per-worktree, invisible to
#     `git status` when the tree is clean), or
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
# NOT protected: gitignored files. Like `git worktree remove` itself, the
# status checks here never see ignored content — a hand-made .env or local
# build artifact is removed with the worktree. A block would trip on
# node_modules/ in every worktree, so this stays a documented exemption.
#
# --throwaway: the caller attests it created this worktree moments ago from
# fetched state and nothing worked in it since (automation cleaning up after
# itself). Submodule ref checks then degrade from ls-remote pushed-ness to
# local containment — anything not reachable from a remote-tracking ref
# still blocks — and never touch the network, so cleanup cannot strand on a
# dead VPN or an expired credential. Never pass it for a worktree a human
# has worked in: it reopens the local-tag blind spot ls-remote exists to
# close.
#
# usage: scripts/remove-worktree.sh [--throwaway] <worktree-path>
set -euo pipefail

throwaway=false
if [ "${1:-}" = "--throwaway" ]; then
  throwaway=true
  shift
fi
worktree_path="${1:-}"
[ -n "$worktree_path" ] || { echo "usage: remove-worktree.sh [--throwaway] <worktree-path>" >&2; exit 2; }
[ -d "$worktree_path" ] || { echo "remove-worktree: no such directory: $worktree_path" >&2; exit 1; }

blocked=false

# capture <cmd...> — stdout into g_out, stderr into g_err, command status
# returned. Value-bearing captures must never merge stderr into the value:
# git writes warnings to stderr while exiting 0 (an unreadable global
# config, say), and a warning folded into a status listing or a sha turns a
# clean worktree into a false block — which, from the throwaway cleanup
# path, means a worktree kept forever.
g_out="" g_err=""
capture() {
  local errf rc=0
  errf=$(mktemp)
  g_out=$("$@" 2>"$errf") || rc=$?
  g_err=$(cat "$errf" 2>/dev/null || true)
  rm -f "$errf"
  return "$rc"
}

# The superproject worktree itself: plain `git worktree remove` would refuse
# on modified or untracked files, and --force below would silently discard
# them — so do that check here first. Submodules are excluded entirely: a
# gitlink difference is not an uncommitted file, and every submodule state
# gets its own dedicated check below, with remedies that actually work.
if ! capture git -C "$worktree_path" status --porcelain --ignore-submodules=all; then
  echo "remove-worktree: cannot read worktree state: $g_err" >&2
  exit 1
fi
wt_status=$g_out
if [ -n "$wt_status" ]; then
  echo "remove-worktree: worktree has uncommitted or untracked files:" >&2
  printf '%s\n' "$wt_status" | sed -n '1,5p' | sed 's/^/    /' >&2
  blocked=true
fi

if ! capture git -C "$worktree_path" rev-parse --absolute-git-dir; then
  echo "remove-worktree: cannot resolve worktree gitdir: $g_err" >&2
  exit 1
fi
wt_gitdir=$g_out

# The worktree's own per-worktree gitdir dies with the removal, exactly like
# a submodule's. A commit reachable only from this worktree's HEAD (or from
# refs/worktree/*) has no other home — the per-worktree reflog dies too. The
# test is reachability from any shared ref, deliberately NOT ls-remote:
# this is loss prevention, not publication, and worktrees for local-only
# branches are routine — a pushed-ness test would refuse every one of them.
wt_refs=$(git -C "$worktree_path" for-each-ref --format='%(refname)' 'refs/worktree/**' 2>/dev/null || true)
# An unborn HEAD (`git worktree add --orphan`) resolves to no commit and has
# none to lose — include it as a source only when it points at one, or the
# log below hard-fails and the worktree becomes permanently un-removable.
head_src=""
git -C "$worktree_path" rev-parse --verify --quiet HEAD >/dev/null 2>&1 && head_src=HEAD
if [ -n "$head_src$wt_refs" ]; then
  # $head_src/$wt_refs intentionally unquoted: one argument per refname,
  # never whitespace, and an empty one must vanish rather than become "".
  # shellcheck disable=SC2086
  if ! capture git -C "$worktree_path" log --oneline $head_src $wt_refs --not --branches --tags --remotes --; then
    echo "remove-worktree: cannot enumerate the worktree's own commits: $g_err" >&2
    exit 1
  fi
  wt_only=$g_out
  if [ -n "$wt_only" ]; then
    echo "remove-worktree: the worktree has commits reachable only from its own HEAD:" >&2
    printf '%s\n' "$wt_only" | sed -n '1,5p' | sed 's/^/    /' >&2
    echo "    Keep them: 'git -C $worktree_path branch <name>' puts them on a shared ref." >&2
    blocked=true
  fi
fi

# Paused operations keep their state in the per-worktree gitdir, invisible
# to `status --porcelain` when the tree is clean — a half-narrowed bisect or
# a `rebase -i` stopped at an edit (todo list, --autostash content) would be
# silently destroyed. Presence is the only reliable signal: a bisect HEAD is
# usually a pushed commit, so the reachability check above never fires.
in_progress=""
for op_state in rebase-merge rebase-apply sequencer MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
  [ -e "$wt_gitdir/$op_state" ] && in_progress="$in_progress $op_state"
done
if [ -n "$in_progress" ]; then
  echo "remove-worktree: an operation is in progress in this worktree (found:$in_progress)." >&2
  echo "    Finish or abort it first (git rebase --abort, git bisect reset, git merge --abort, ...)." >&2
  blocked=true
fi

# check_submodule_refs <label> <git...> — refuse when the submodule holds
# commits no remote has, or stashes. The git invocation prefix is either
# `git -C <checkout>` or `git --git-dir <module-gitdir>` so the same checks
# run whether or not a checkout exists on disk.
check_submodule_refs() {
  local sub="$1"; shift
  local remotes remote remote_refs sha ref unpushed stashes reason reached=false
  local pushed=()

  # In --throwaway mode the network probe is skipped entirely: the caller
  # created this worktree moments ago from fetched state, so the submodule's
  # remote-tracking refs are fresh and local containment against them is the
  # whole check. Anything not reachable from a remote-tracking ref still
  # blocks — a commit made inside the submodule since creation is caught.
  if [ "$throwaway" = false ]; then

  # The remote name is whatever this submodule actually has — never assume
  # `origin`; a renamed remote must not read as an unreachable one.
  if ! capture "$@" remote; then
    echo "remove-worktree: cannot list remotes for $sub: $g_err" >&2
    exit 1
  fi
  remotes=$g_out
  if [ -z "$remotes" ]; then
    echo "remove-worktree: $sub has no remote — nothing in it can be verified as pushed." >&2
    blocked=true
    return 0
  fi

  # What the remotes actually have, fresh — remote-tracking refs alone miss
  # tags entirely. Fail closed only when NO remote answers: guessing while
  # offline is how work gets lost.
  local failed_remotes=""
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
      failed_remotes="$failed_remotes $remote"
    fi
  done
  if [ "$reached" = false ]; then
    # Keep git's own reason — a bad URL, an expired credential, and a DNS
    # outage must not all collapse into one indistinguishable line. The
    # re-probe happens only here, on the path that already failed and
    # exits, so successful runs never pay for it. Skip warning lines (ssh
    # known-hosts, https redirects) — the first non-warning line is the
    # actual cause; the first line often is not.
    echo "remove-worktree: cannot reach any remote to verify pushed refs for $sub:" >&2
    for remote in $failed_remotes; do
      reason=$("$@" ls-remote --heads --tags "$remote" 2>&1 >/dev/null | grep -iv '^warning:' | sed -n '1p' || true)
      echo "    $remote: ${reason:-no error output}" >&2
    done
    exit 1
  fi

  fi # [ "$throwaway" = false ]

  # Everything local — every ref plus HEAD, so notes, replace refs and other
  # namespaces are covered, minus refs/stash which has its own check with a
  # better message — against everything the remotes have. --remotes stays as
  # a second exclusion source so commits pushed before a remote moved on are
  # still recognized. In --throwaway mode tags are excluded too: a fetched
  # tag need not be reachable from any remote branch, so a fresh clone
  # legitimately holds tags the remote-tracking refs cannot account for, and
  # the attestation is precisely that nobody created one locally since.
  # Note: after --not, revs are negated WITHOUT a ^ prefix (a ^ there would
  # flip them back to included). No pipe into a truncating command — head's
  # early exit would SIGPIPE git under pipefail; capture fully, truncate for
  # display after.
  local exclusions=(--remotes)
  [ "$throwaway" = true ] && exclusions+=(--tags)
  if ! capture "$@" log --oneline --exclude=refs/stash --all --not "${exclusions[@]}" ${pushed[@]+"${pushed[@]}"} --; then
    echo "remove-worktree: cannot enumerate submodule commits for $sub: $g_err" >&2
    exit 1
  fi
  unpushed=$g_out
  if [ -n "$unpushed" ]; then
    echo "remove-worktree: $sub has commits no remote has:" >&2
    printf '%s\n' "$unpushed" | sed -n '1,5p' | sed 's/^/    /' >&2
    blocked=true
  fi

  # Stashes are per-gitdir too and invisible to git log's ref selectors.
  if ! capture "$@" stash list; then
    echo "remove-worktree: cannot read stash list for $sub: $g_err" >&2
    exit 1
  fi
  stashes=$g_out
  if [ -n "$stashes" ]; then
    echo "remove-worktree: $sub has stashed changes:" >&2
    printf '%s\n' "$stashes" | sed -n '1,5p' | sed 's/^/    /' >&2
    blocked=true
  fi
}

# check_module_gitdirs <modules-root> <label-prefix> — run the ref/stash
# checks against every module gitdir that exists under a modules/ directory,
# nested ones included (git nests them under a parent's modules/).
check_module_gitdirs() {
  local modules_root="$1" label_prefix="$2" cfg module_gitdir find_errf
  [ -d "$modules_root" ] || return 0
  # A find error (unreadable directory, say) means some module gitdirs were
  # never enumerated, and a walk that silently skipped them would pass a
  # worktree it never actually checked — collect stderr and refuse instead.
  find_errf=$(mktemp)
  while IFS= read -r -d '' cfg; do
    module_gitdir="${cfg%/config}"
    [ -f "$module_gitdir/HEAD" ] || continue
    # Every git call against a module gitdir needs --work-tree pointed at a
    # directory that exists: core.worktree in the gitdir may reference a
    # deleted checkout and git dies on chdir before doing anything —
    # including this sanity check, which would otherwise silently skip
    # exactly the deleted-checkout gitdirs this walk exists to protect.
    git --git-dir "$module_gitdir" --work-tree "$worktree_path" rev-parse --git-dir >/dev/null 2>&1 || continue
    # Label by the gitdir's name under modules/ — the path may no longer
    # exist; none of these checks read the worktree.
    check_submodule_refs "$label_prefix${module_gitdir#"$modules_root/"}" \
      git --git-dir "$module_gitdir" --work-tree "$worktree_path"
  done < <(find "$modules_root" -name config -type f -print0 2>"$find_errf")
  if [ -s "$find_errf" ]; then
    echo "remove-worktree: cannot fully enumerate module gitdirs under $modules_root:" >&2
    sed -n '1,3p' "$find_errf" | sed 's/^/    /' >&2
    rm -f "$find_errf"
    exit 1
  fi
  rm -f "$find_errf"
}

# Pass 1 — checkout state, enumerated from HEAD's tree (gitlink entries):
# uncommitted changes, pointer drift, and gitlink paths holding content that
# is not a submodule checkout. Ref checks happen in pass 2, keyed on the
# gitdirs themselves.
#
# The listing feeds the loop through a process substitution, whose failure
# set -e cannot see — a failing ls-tree would silently skip every pass-1
# check. So when HEAD is born (an unborn HEAD has no tree and no gitlinks —
# nothing here to check), run the listing once for its verdict first; the
# loop then reads a second run of the same command against the same object
# store. Two runs because command substitution cannot carry the
# NUL-delimited stream.
if [ -n "$head_src" ]; then
  if ! lstree_err=$(git -C "$worktree_path" ls-tree -r -z HEAD 2>&1 >/dev/null); then
    echo "remove-worktree: cannot enumerate HEAD's tree: $lstree_err" >&2
    exit 1
  fi
fi
while IFS= read -r -d '' entry; do
  mode="${entry%% *}"
  [ "$mode" = "160000" ] || continue
  sub="${entry#*$'\t'}"
  subdir="$worktree_path/$sub"

  if [ -e "$subdir/.git" ]; then
    # Populated checkout: uncommitted changes, then pointer drift.
    if ! capture git -C "$subdir" status --porcelain; then
      echo "remove-worktree: cannot read submodule state for $sub: $g_err" >&2
      exit 1
    fi
    sub_status=$g_out
    if [ -n "$sub_status" ]; then
      echo "remove-worktree: $sub has uncommitted changes" >&2
      blocked=true
    fi
    # A checkout that differs from the commit this branch records is either
    # a stale checkout after a branch switch (lossless) or a pointer bump
    # not yet committed. Both deserve a block with the actual way out —
    # `git stash` / `git checkout -- .` cannot clear a gitlink difference.
    if ! capture git -C "$worktree_path" rev-parse "HEAD:$sub"; then
      echo "remove-worktree: cannot read recorded commit for $sub: $g_err" >&2
      exit 1
    fi
    recorded=$g_out
    if ! capture git -C "$subdir" rev-parse HEAD; then
      echo "remove-worktree: cannot read checked-out commit for $sub: $g_err" >&2
      exit 1
    fi
    checked_out=$g_out
    if [ "$recorded" != "$checked_out" ]; then
      echo "remove-worktree: $sub is checked out at ${checked_out:0:12}, but the branch records ${recorded:0:12}." >&2
      echo "    Stale checkout: sync it with 'git submodule update -- $sub'." >&2
      echo "    Pointer bump you meant to keep: commit it in the superproject first." >&2
      blocked=true
    fi
    # A .git DIRECTORY (not the gitfile `git submodule update` writes) means
    # the gitdir is embedded in the checkout — e.g. a hand-run `git clone`
    # into the path. Pass 2 never sees it (it only walks <gitdir>/modules),
    # so its refs are checked here — including any module gitdirs nested
    # under it (a `git clone --recursive` puts them in .git/modules).
    if [ -d "$subdir/.git" ]; then
      check_submodule_refs "$sub" git -C "$subdir"
      check_module_gitdirs "$subdir/.git/modules" "$sub: "
    fi
  elif [ -d "$subdir" ] && entries=$(ls -A "$subdir" 2>/dev/null) && [ -z "$entries" ]; then
    # The empty placeholder directory git materializes at every
    # uninitialized gitlink path — benign, nothing to lose. An ls that
    # FAILS must not read as emptiness: the && chain falls through to the
    # foreign-content block below, keeping unlistable directories fail-closed.
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
check_module_gitdirs "$wt_gitdir/modules" ""

if [ "$blocked" = true ]; then
  echo "remove-worktree: refusing — push or discard the work above first." >&2
  exit 1
fi

git -C "$worktree_path" worktree remove --force "$worktree_path"
echo "remove-worktree: removed $worktree_path"
