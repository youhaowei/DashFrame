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

# init_unpopulated_submodules <worktree_path>
# Initialize any submodule that is not populated yet. This is the only place
# submodules are synced automatically — there is deliberately no post-checkout
# hook, so a library checkout you moved to a feature branch stays where you
# put it; populated submodules are never touched here. Runs on the reuse path
# too, so a bootstrap that failed mid-init heals on the next invocation.
# Fail-closed: a worktree with an empty libs/ must not be handed to an agent.
init_unpopulated_submodules() {
  _isu_wt="$1"
  [ -f "$_isu_wt/.gitmodules" ] || return 0
  for _isu_sub in $(git config --file "$_isu_wt/.gitmodules" --get-regexp 'submodule\..*\.path' 2>/dev/null | awk '{print $2}'); do
    # Skip only a checkout that is actually usable. `.git` existing alone is
    # not that: an interrupted init can write the gitfile before the checkout
    # lands, and skipping on it would hand out a worktree with an empty
    # library. Nor is HEAD resolving alone: submodule init clones with
    # --no-checkout first, so an interruption between clone and checkout
    # leaves a resolvable HEAD over an empty tree. Healthy means both HEAD
    # resolves AND at least one file HEAD actually records exists on disk —
    # untracked debris like .DS_Store must not vouch for a checkout, so the
    # test walks HEAD's own file list rather than asking whether the
    # directory is non-empty. Anything else falls through to the update
    # below, which repairs it. A populated checkout on its own branch —
    # dirty or not — passes and stays untouched: even with every file but
    # one deleted, that one file is still a tracked file present on disk,
    # and repairing on any weaker signal would clobber exactly the edits
    # this script promises never to touch.
    _isu_tracked_present=""
    if [ -e "$_isu_wt/$_isu_sub/.git" ] \
      && git -C "$_isu_wt/$_isu_sub" rev-parse --verify --quiet HEAD >/dev/null 2>&1; then
      _isu_tracked_present=$(git -C "$_isu_wt/$_isu_sub" ls-tree -r --name-only HEAD 2>/dev/null \
        | while IFS= read -r _isu_f; do
            if [ -e "$_isu_wt/$_isu_sub/$_isu_f" ] || [ -L "$_isu_wt/$_isu_sub/$_isu_f" ]; then
              echo yes
              break
            fi
          done)
    fi
    if [ -n "$_isu_tracked_present" ]; then
      continue
    fi
    # A half-initialized checkout (gitfile present) needs --force: plain
    # `submodule update` is a no-op when HEAD already matches the recorded
    # sha, so it would leave the empty tree in place. --force re-checks-out
    # regardless, and only checkouts the healthy gate above rejected can
    # reach it — there is nothing here to clobber. A fully unpopulated path
    # (no gitfile) takes the plain init, as before.
    _isu_force=""
    [ -e "$_isu_wt/$_isu_sub/.git" ] && _isu_force="--force"
    # shellcheck disable=SC2086
    if ! git -C "$_isu_wt" submodule update --init --recursive $_isu_force -- "$_isu_sub" >&2; then
      echo "ERROR [ensure-worktree]: failed to initialize submodule '$_isu_sub' in '$_isu_wt'." >&2
      echo "  Fix connectivity/credentials and re-run; this script retries unpopulated submodules." >&2
      exit 1
    fi
  done
}

# install_dependencies <worktree_path> <mode: create|reuse>
# A fresh worktree has no node_modules at all: `git worktree add` copies
# tracked files only, and nothing else in this script installs. Every agent
# that then tries to run the app or the test suite hits a different symptom of
# the same cause — a missing Electron binary, an unresolvable `@wystack/*`
# import, `vitest: command not found` — and has to rediscover that the answer
# is `bun install`. Doing it here makes the printed path mean "ready to work
# in", which is what every caller already assumes it means.
#
# Idempotent and near-free when the worktree is already installed, so this
# also heals the reuse path.
#
# The two modes differ because the cost of refusing differs. On `create` the
# worktree is a fresh checkout of a committed tree, so the lockfile matches by
# construction: `--frozen-lockfile` costs nothing, catches a genuinely broken
# lockfile, and guarantees provisioning never leaves `bun.lock` modified in a
# brand-new worktree. Failing there strands nobody — no work exists in it yet.
#
# On `reuse` an agent is already working in the tree and may legitimately have
# edited a manifest without regenerating the lockfile. Enforcing frozen there
# would make the sanctioned bootstrap refuse to hand back a worktree that
# already exists and is the only place their work lives — a loop with no exit,
# since teardown needs the path too. So reuse installs unfrozen, and an install
# failure warns rather than exits: the caller still gets the path, and a stale
# node_modules is a recoverable state where a withheld path is not.
install_dependencies() {
  _idep_wt="$1"
  _idep_mode="$2"

  if ! command -v bun >/dev/null 2>&1; then
    echo "ERROR [ensure-worktree]: 'bun' is not on PATH; cannot install dependencies in '$_idep_wt'." >&2
    echo "  Install bun (see AGENTS.md) and re-run; this script is safe to re-run on an existing worktree." >&2
    exit 1
  fi

  if [ "$_idep_mode" = "create" ]; then
    echo "[ensure-worktree] installing dependencies (bun install --frozen-lockfile)..." >&2
    if ! (cd "$_idep_wt" && bun install --frozen-lockfile >&2); then
      echo "ERROR [ensure-worktree]: 'bun install --frozen-lockfile' failed in the new worktree '$_idep_wt'." >&2
      echo "  The lockfile does not match the manifests on this branch. Fix it and re-run;" >&2
      echo "  this script is safe to re-run on an existing worktree." >&2
      exit 1
    fi
    return
  fi

  echo "[ensure-worktree] refreshing dependencies (bun install)..." >&2
  if ! (cd "$_idep_wt" && bun install >&2); then
    echo "WARNING [ensure-worktree]: 'bun install' failed in the existing worktree '$_idep_wt'." >&2
    echo "  Returning the path anyway — your work lives there. Dependencies may be stale;" >&2
    echo "  resolve the install error inside the worktree before running the app or tests." >&2
  fi
}

# assert_submodule_pins_pushed <rev>
# Refuse to provision a worktree whose submodule pins point at commits no
# submodule remote has.
#
# The trap this closes: a worktree is created from a rev whose libs/wystack
# pin is a local-only commit, an agent builds on it, and the submodule change
# later lands upstream as a SQUASH — which publishes the content under a
# brand-new sha and leaves the pinned commit reachable from nothing on the
# remote. From then on that worktree's submodule gitdir is the only copy,
# teardown correctly refuses to destroy it, and the worktree is stuck until a
# human adjudicates. Blocking at creation costs one ls-remote per submodule
# and avoids that situation.
#
# Submodule gitdirs are PER-WORKTREE, so a pin authored inside a sibling
# worktree is absent from this checkout's submodule object store even though
# it exists on the machine. Such a pin is therefore judged the same way as
# any other: fetch every head and tag the remote advertises, and if the
# commit still is not here, no remote has it — refuse. Skipping it for being
# locally unknown would miss the very case this guard exists for.
#
# Per AGENTS.md a submodule change lands in its own repo FIRST, so a
# legitimate in-flight pin is always on a pushed branch and passes here. A
# pin that fails is a local-only commit — push it or reset the submodule.
#
# Deliberately NOT fatal when no remote answers: this guard prevents an
# awkward situation, it is not the data-loss guard (remove-worktree.sh is),
# and failing closed here would make offline worktree creation impossible.
# It warns loudly on stderr instead.
assert_submodule_pins_pushed() {
  _aspp_rev="$1"
  [ -f "$repo_root/.gitmodules" ] || return 0
  for _aspp_sub in $(git config --file "$repo_root/.gitmodules" --get-regexp 'submodule\..*\.path' 2>/dev/null | awk '{print $2}'); do
    # An unpopulated submodule has no local object store and nothing at risk:
    # the new worktree clones it fresh from the remote, so a pin the remote
    # does not have fails loudly at checkout rather than silently here.
    [ -e "$repo_root/$_aspp_sub/.git" ] || continue
    _aspp_pin=$(git -C "$repo_root" rev-parse --verify --quiet "$_aspp_rev:$_aspp_sub" 2>/dev/null || echo "")
    [ -n "$_aspp_pin" ] || continue

    _aspp_tips=""
    _aspp_reached=false
    for _aspp_remote in $(git -C "$repo_root/$_aspp_sub" remote); do
      _aspp_refs=$(git -C "$repo_root/$_aspp_sub" ls-remote --heads --tags "$_aspp_remote" 2>/dev/null) || continue
      _aspp_reached=true
      # A tip sha whose object was never fetched cannot exclude anything, and
      # dropping it silently would read the whole upstream history as
      # unpushed — the same false-refusal bug remove-worktree.sh carried.
      # Fetch once when something is missing; a failed fetch merely leaves the
      # tip list shorter, which errs toward complaining rather than toward
      # vouching for a pin no remote actually has. --tags is required: the
      # default refspec auto-follows a tag only when its object is reachable
      # from fetched branch history, so a tag sitting on no branch — exactly
      # the tip most likely to be missing — would never arrive.
      # The pin itself counts as a missing object worth fetching for: it may
      # have been authored in a sibling worktree's submodule gitdir (those are
      # per-worktree) and pushed from there, in which case this store has
      # never seen it but the remote has.
      _aspp_missing=false
      git -C "$repo_root/$_aspp_sub" cat-file -e "$_aspp_pin" 2>/dev/null || _aspp_missing=true
      for _aspp_sha in $(printf '%s\n' "$_aspp_refs" | awk '{print $1}'); do
        git -C "$repo_root/$_aspp_sub" cat-file -e "$_aspp_sha" 2>/dev/null || _aspp_missing=true
      done
      if [ "$_aspp_missing" = true ]; then
        git -C "$repo_root/$_aspp_sub" fetch --quiet --tags "$_aspp_remote" >/dev/null 2>&1 || true
      fi
      for _aspp_sha in $(printf '%s\n' "$_aspp_refs" | awk '{print $1}'); do
        if git -C "$repo_root/$_aspp_sub" cat-file -e "$_aspp_sha" 2>/dev/null; then
          _aspp_tips="$_aspp_tips $_aspp_sha"
        fi
      done
    done

    if [ "$_aspp_reached" = false ]; then
      echo "WARNING [ensure-worktree]: could not reach any remote of submodule '$_aspp_sub' — its pin was not verified as pushed." >&2
      continue
    fi

    # The pin is still absent after fetching every head and tag a reachable
    # remote advertises. It is therefore reachable from nothing on that
    # remote — typically a commit authored in a sibling worktree's submodule
    # gitdir and never pushed. Refuse: `git worktree add` would succeed and
    # `git submodule update` would then die with "not our ref", leaving a
    # half-created worktree and a misleading connectivity error.
    if ! git -C "$repo_root/$_aspp_sub" cat-file -e "$_aspp_pin" 2>/dev/null; then
      echo "ERROR [ensure-worktree]: '$_aspp_rev' pins submodule '$_aspp_sub' at $(printf '%.12s' "$_aspp_pin"), which no remote of that submodule has and this checkout does not hold." >&2
      echo "  A submodule commit made inside another worktree lives in that worktree's own gitdir." >&2
      echo "  Push it from there — land it in the submodule's own repo (AGENTS.md), then bump the pin —" >&2
      echo "  or point '$_aspp_rev' back at a commit the submodule remote has." >&2
      if [ -n "${_wt_log:-}" ]; then rm -f "$_wt_log"; fi
      exit 1
    fi

    # A failing `git log` must not read as "pushed": that is the one way this
    # guard could fail open. Warn and move on instead of vouching for the pin.
    _aspp_rc=0
    # shellcheck disable=SC2086
    _aspp_unpushed=$(git -C "$repo_root/$_aspp_sub" log --oneline "$_aspp_pin" --not $_aspp_tips -- 2>/dev/null) || _aspp_rc=$?
    if [ "$_aspp_rc" -ne 0 ]; then
      echo "WARNING [ensure-worktree]: could not test the pin of submodule '$_aspp_sub' (git log exited $_aspp_rc) — not verified as pushed." >&2
      continue
    fi
    if [ -n "$_aspp_unpushed" ]; then
      echo "ERROR [ensure-worktree]: '$_aspp_rev' pins submodule '$_aspp_sub' at $(printf '%.12s' "$_aspp_pin"), which no remote of that submodule has." >&2
      printf '%s\n' "$_aspp_unpushed" | sed -n '1,5p' | sed 's/^/    /' >&2
      echo "  Building on an unpushed submodule commit is how work gets orphaned: if that change" >&2
      echo "  later lands upstream as a squash, the pinned sha becomes reachable from nothing and" >&2
      echo "  this worktree's submodule gitdir is its only copy." >&2
      echo "  Fix it first, in $repo_root/$_aspp_sub:" >&2
      echo "    push it   — land the submodule change in its own repo (AGENTS.md), then bump the pin; or" >&2
      echo "    reset it  — point '$_aspp_rev' back at a commit the submodule remote has." >&2
      # The create paths call this after mktemp'ing the worktree-add log; the
      # reuse path never sets it. Clean it up rather than leak a temp file.
      if [ -n "${_wt_log:-}" ]; then rm -f "$_wt_log"; fi
      exit 1
    fi
  done
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
  _wt_top=$(git rev-parse --show-toplevel)
  init_unpopulated_submodules "$_wt_top"
  install_dependencies "$_wt_top" reuse
  echo "$_wt_top"
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
  # Deliberately NOT guarded: this worktree already exists, so there is no
  # creation to refuse — a block here would only withhold the path to a
  # worktree that is already on disk, and since remove-worktree.sh rightly
  # refuses to destroy unpushed submodule work, the worktree could then be
  # neither entered nor torn down through the sanctioned tooling. The
  # early-return path for a caller already inside a worktree is unguarded for
  # the same reason.
  init_unpopulated_submodules "$worktree_path"
  install_dependencies "$worktree_path" reuse
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
  assert_submodule_pins_pushed "$branch"
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
    # refs/remotes/origin/<branch> ref, which only exists after a fetch. Fail
    # closed if the fetch itself fails rather than silently falling back to
    # whatever (possibly stale, possibly absent) refs/remotes/origin/<branch>
    # already exists locally.
    if ! git fetch origin "$branch" >/dev/null 2>&1; then
      echo "ERROR [ensure-worktree]: branch '$branch' exists on origin but 'git fetch origin $branch' failed — not falling back to a possibly stale local ref." >&2
      exit 1
    fi
    assert_submodule_pins_pushed "origin/$branch"
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
    #
    # DashFrame convention: upstream default branch is always main (CI,
    # branch protection). We hardcode origin/main here rather than deriving
    # from origin/HEAD — that would be the right call if this script were
    # vendored for other repos, but it wouldn't change behaviour here.
    git fetch origin main >/dev/null 2>&1 || true
    if ! git show-ref --verify --quiet "refs/remotes/origin/main"; then
      rm -f "$_wt_log"
      echo "ERROR [ensure-worktree]: branch '$branch' not found locally or on origin, and 'origin/main' is unavailable to branch from." >&2
      exit 1
    fi
    assert_submodule_pins_pushed "origin/main"
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

init_unpopulated_submodules "$worktree_path"
install_dependencies "$worktree_path" create

echo "$worktree_path"
