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
#   - Installs dependencies once, the first time a worktree is provisioned, so
#     the path it prints means "ready to work in".  An already-provisioned
#     worktree is handed back untouched.  See install_dependencies.
#   - Hard-fails (exit 1) on any provisioning or validation failure — this is
#     fail-closed by design so that a briefed agent cannot silently proceed in
#     main.
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

# acquire_provisioning_lock <lock_file>
# Serialize provisioning of one worktree, so only the holder may inspect,
# delete, or write its node_modules and provisioning markers. Returns 0 with
# the lock held, 1 if this host has no locking tool; exits 1 on timeout.
#
# The pending marker below cannot authorize cleanup by itself, because it means
# two different things: an attempt that died, and an attempt running right now.
# Unserialized, a second agent provisioning the same branch reads the first
# agent's LIVE marker as abandoned debris and `rm -rf`s node_modules out from
# under an install in flight; either process can then mark the wreckage
# provisioned. That hazard arrived with the pending marker — before it, a
# concurrent caller hit the backfill gate and returned harmlessly — so the lock
# ships with it.
#
# The lock is a kernel flock(2) on fd 9, taken by lockf(1) (macOS) or flock(1)
# (Linux), NOT a pid file. That distinction is the whole design:
#
#   - There is nothing to release and no stale state to reclaim. The lock lives
#     on the open file description, so the kernel drops it when the last holder
#     exits — including SIGKILL, a crash, or a reboot. Every "break the stale
#     lock" race disappears because there is no breaking step: no pid to read,
#     no window between creating the lock and publishing ownership, and no way
#     for a dying process to delete a successor's lock.
#   - Children inherit fd 9, so the lock covers the ACTUAL writers. Killing the
#     provisioning shell while its `cp` or `bun install` keeps running does not
#     release it — a retry blocks until that writer is gone, instead of deleting
#     node_modules from under it. Verified both ways: while an orphaned child
#     held the fd, another acquirer got 75 (timeout); once it exited, 0.
#
# Nothing is unlocked here. install_dependencies is the only critical section,
# and the script exits shortly after it, which closes the fd.
#
# A host with neither tool gets no lock, and the caller then skips the clone and
# the pending marker with it: the optimization and the machinery that makes it
# safe are one unit, so without the lock the script behaves exactly as it did
# before the clone existed.
acquire_provisioning_lock() {
  _apl_lock="$1"

  if command -v lockf >/dev/null 2>&1; then
    _apl_tool=lockf
  elif command -v flock >/dev/null 2>&1; then
    _apl_tool=flock
  else
    return 1
  fi

  # Prove the open succeeds BEFORE `exec` does it. A redirection error on
  # `exec` does not reliably abort: called as the condition of an `if`, this
  # function keeps running past a failed one, and if fd 9 happened to be open
  # already, the lock tool would lock that unrelated descriptor and report
  # success — the critical section entered while believing itself locked. The
  # concrete way to get here is a DIRECTORY at the lock path, which is exactly
  # what an older revision of this script created. `: >` opens with the same
  # semantics as the redirection below, so it fails on precisely the cases the
  # redirection would.
  if [ -e "$_apl_lock" ] && [ ! -f "$_apl_lock" ]; then
    echo "WARNING [ensure-worktree]: '$_apl_lock' exists and is not a regular file; provisioning unserialized." >&2
    echo "  Remove it to restore locking." >&2
    return 1
  fi
  if ! : >"$_apl_lock" 2>/dev/null; then
    echo "WARNING [ensure-worktree]: cannot open '$_apl_lock'; provisioning unserialized." >&2
    return 1
  fi

  exec 9>"$_apl_lock"

  # `|| _apl_rc=$?` rather than a bare call: `set -e` would abort the script on
  # a contended lock before the status could be read.
  _apl_rc=0
  if [ "$_apl_tool" = lockf ]; then
    lockf -s -t 300 9 || _apl_rc=$?
  else
    # -E makes a flock(1) timeout report 75 too, so one code means one thing.
    flock -E 75 -w 300 9 || _apl_rc=$?
  fi
  if [ "$_apl_rc" -eq 0 ]; then
    return 0
  fi

  # Only 75 (EX_TEMPFAIL) means "held by someone else". Any other status means
  # the tool would not lock this way here at all — a usage error from a build
  # whose lockf(1) predates the `lockf [-s] [-t seconds] fd` form, say, which
  # exits 64. Treating that as contention would make every invocation on such a
  # host fail fatally at a lock nobody holds, and this gate runs before the
  # provisioned check, so it would break reuse of already-provisioned worktrees
  # too. Degrade instead: no lock, and the caller then skips the clone and the
  # pending marker, which is exactly the pre-optimization behaviour.
  if [ "$_apl_rc" -ne 75 ]; then
    echo "WARNING [ensure-worktree]: '$_apl_tool' could not lock '$_apl_lock' (exit $_apl_rc); provisioning unserialized." >&2
    exec 9>&-
    return 1
  fi

  # Fail closed. Handing back a path while another process installs into it is
  # the outcome this function exists to prevent, and a wait that outlasts a cold
  # install means whatever holds the lock needs a human to look at it.
  echo "ERROR [ensure-worktree]: timed out after 300s waiting for another process to finish provisioning '$_apl_lock'." >&2
  echo "  Another ensure-worktree.sh, or something it started, still holds the lock." >&2
  echo "  Wait for it to finish, or stop it, then re-run." >&2
  exit 1
}

# clone_node_modules <worktree_path>
# Seed a never-provisioned worktree's package store by APFS-cloning the main
# checkout's, so the install that follows has almost nothing left to fetch.
#
# `bun install` in a fresh worktree costs ~313 MiB of real disk even with a warm
# bun cache, because the parts bun materialises rather than links — Electron's
# unpacked `dist`, every extracted package tree — are written as new blocks per
# worktree. Cloning first costs ~43 MiB: `cp -c` is macOS copy-on-write
# (clonefile), so the copy shares blocks with the source until something writes.
#
# ONLY the package entries under `node_modules/.bun` are cloned — never the
# whole tree, and never `.bun/node_modules` — and both exclusions are
# correctness requirements rather than tuning choices.
#
# `.bun` is bun's content-addressed store, keyed by name@version plus a hash of
# the resolved dependency set. Its package entries are safe to over-seed: an
# entry this branch does not want is inert, because reaching it requires a link
# from the farm bun rebuilds. What is NOT safe is `.bun/node_modules`, the
# store's shared resolution directory. Node walks parent directories looking for
# `node_modules`, so from inside any store entry that directory is on the
# lookup path, and a foreign package left in it resolves. Measured on a
# two-package fixture whose source declared `is-odd` and whose target did not:
# cloning `.bun` whole left `is-odd` resolvable from inside `is-number`; cloning
# it without `.bun/node_modules` did not, and bun rebuilt the directory to the
# same single entry a clean install produces.
#
# Everything ABOVE the store — the top-level packages, the per-workspace
# `node_modules`, the `.bin` shims — is likewise a symlink farm that bun rebuilds
# from THIS branch's lockfile, and it is where a whole-tree clone did damage:
#
#   - `bun install --frozen-lockfile` does not prune. Verified: a package the
#     lockfile does not declare, and a symlink pointing outside the worktree,
#     both survive it untouched.
#   - This repo supports `bun link` to point an `@wystack/*` package at a
#     checkout elsewhere (README.md, submodule workflow). Cloning a main
#     checkout that has one would copy that link into every new worktree, so
#     agents meant to be isolated would silently build against a shared external
#     tree — the exact failure worktrees exist to prevent.
#
# Cloning only the store's package entries makes both moot: bun writes every
# link itself, so nothing foreign is on any resolution path. Measured after the
# narrowing, the install is still the same no-op — "Checked 1597 installs across
# 1668 packages (no changes) [511ms]" — and rebuilt exactly the 17 top-level
# entries the lockfile calls for.
#
# This is an OPTIMISATION ONLY, never a substitute for the install, and the
# ordering is what makes that true. The clone runs after the marker and backfill
# gates and immediately before `bun install --frozen-lockfile`, so the install
# always reconciles what was cloned against this branch's lockfile:
#   identical lockfile  -> a ~550 ms no-op that adds 0 MiB;
#   different lockfile  -> fetches only the delta;
#   clone skipped       -> a full install, exactly as before this existed.
# Seeding before those gates would trip the "node_modules exists -> already
# provisioned" backfill and skip the reconciliation entirely.
#
# What this DOES inherit is the state of the reference store: a package file
# hand-edited or corrupted under the main checkout's `.bun` is cloned into every
# worktree seeded afterwards, and `bun install --frozen-lockfile` verifies the
# lockfile, not the contents of packages already present. Seeding from any local
# reference has that property — bun's own global cache already did, one level
# up — and the remedy is the same at both levels: repair the reference, then
# `rm -rf node_modules` in the affected worktree and re-provision. Verifying
# every cloned package instead would cost more than the clone saves.
#
# Every failure is non-fatal by construction — a machine without APFS, a
# WORKTREE_BASE on another volume, a main checkout that has never installed or
# uses a linker with no store. A partial copy is removed rather than left for
# bun to reason about. A copy that succeeds but whose install then does not is
# the caller's pending marker to clean up, not this function's.
clone_node_modules() {
  _cnm_wt="$1"

  # The reference is the main checkout, found from the common gitdir rather
  # than $repo_root: install_dependencies is also reached from the path where
  # the caller was already inside a worktree, which never sets repo_root.
  _cnm_common=$(cd "$_cnm_wt" && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 0
  _cnm_src=$(dirname "$_cnm_common")/node_modules/.bun
  [ -d "$_cnm_src" ] || return 0
  [ -e "$_cnm_wt/node_modules/.bun" ] && return 0

  # clonefile cannot cross volumes. Skip rather than let cp fall back to a real
  # copy of ~1.4 GiB, which would be slower than the install it is meant to
  # save.
  _cnm_src_dev=$(stat -f '%d' "$_cnm_src" 2>/dev/null || echo "")
  _cnm_dst_dev=$(stat -f '%d' "$_cnm_wt" 2>/dev/null || echo "")
  if [ -z "$_cnm_src_dev" ] || [ "$_cnm_src_dev" != "$_cnm_dst_dev" ]; then
    return 0
  fi

  # Same volume is not enough: `cp -c` does NOT fail when the filesystem cannot
  # clone, it silently falls back to copyfile(2) and reports success (cp(1):
  # "if ... the target filesystem does not support cloning, cp will fallback to
  # using copyfile(2) ... to ensure the copy still succeeds"). Without this the
  # only signal that a whole store was byte-copied would be the wall clock.
  # Anything that is not APFS — another macOS filesystem, or a non-macOS host
  # where this parse yields nothing — skips to the plain install.
  _cnm_fstype=$(mount 2>/dev/null | awk -v dev="/dev/$(stat -f '%Sd' "$_cnm_wt" 2>/dev/null)" \
    '$1 == dev { sub(/^\(/, "", $4); sub(/,$/, "", $4); print $4; exit }')
  [ "$_cnm_fstype" = "apfs" ] || return 0

  echo "[ensure-worktree] cloning the bun store from '$_cnm_src' (APFS copy-on-write)..." >&2
  mkdir -p "$_cnm_wt/node_modules/.bun"
  # Entry by entry, so `node_modules` — the shared resolution directory that
  # must not be seeded — can be skipped. Any failure abandons the whole clone;
  # a partial store is worse input to `--frozen-lockfile` than none.
  for _cnm_entry in "$_cnm_src"/*; do
    [ -e "$_cnm_entry" ] || continue
    [ "$(basename "$_cnm_entry")" = node_modules ] && continue
    if ! cp -c -R "$_cnm_entry" "$_cnm_wt/node_modules/.bun/" 2>/dev/null; then
      rm -rf "$_cnm_wt/node_modules/.bun"
      echo "[ensure-worktree] clone failed; falling back to a full install." >&2
      return 0
    fi
  done
}

# install_dependencies <worktree_path>
# A fresh worktree has no node_modules at all: `git worktree add` copies
# tracked files only, and nothing else in this script installs. Every agent
# that then tries to run the app or the test suite hits a different symptom of
# the same cause — a missing Electron binary, an unresolvable `@wystack/*`
# import, `vitest: command not found` — and has to rediscover that the answer
# is `bun install`. Doing it here makes the printed path mean "ready to work
# in", which is what every caller already assumes it means.
#
# It installs EXACTLY ONCE per worktree, gated on a marker in the worktree's
# private gitdir, and both halves of that are load-bearing.
#
# The install is preceded by clone_node_modules, which seeds the tree from the
# main checkout at near-zero disk cost. That is purely a head start: the
# install below still runs, and still decides what this branch's node_modules
# must contain.
#
# Installing once, rather than on every call, is what keeps the script safe to
# re-run. `bun install` is not inert on an already-provisioned tree: every
# `@wystack/*` dependency is `workspace:*`, so an install silently re-resolves
# it to the in-repo submodule and undoes any `bun link` pointing at an external
# checkout (README.md, submodule workflow). Refreshing on reuse would mean the
# sanctioned bootstrap command quietly dismantles a developer's linked setup
# every time they ran it. A worktree that is already provisioned is left alone.
#
# Gating on a marker, rather than on `node_modules` existing, is what keeps the
# frozen contract honest. `git worktree add` succeeds before the install runs,
# so a failed first provision leaves a real worktree on disk with a half-built
# or absent node_modules. Keying off the directory would classify that as
# "already provisioned" and hand it back; keying off a marker written only
# after a clean install means the retry is still a first provision, and gets
# the same fail-closed frozen install the original attempt did.
#
# The install is frozen because provisioning must never rewrite `bun.lock`: the
# worktree is a fresh checkout of a committed tree, so the lockfile matches by
# construction, and a mismatch is a genuine defect on the branch rather than
# something to paper over. Failing here strands nobody — no work exists in a
# tree that has never been successfully provisioned.
install_dependencies() {
  _idep_wt="$1"

  _idep_gitdir=$(cd "$_idep_wt" && git rev-parse --absolute-git-dir 2>/dev/null) || {
    echo "ERROR [ensure-worktree]: cannot resolve the gitdir for '$_idep_wt'." >&2
    exit 1
  }
  _idep_marker="$_idep_gitdir/ensure-worktree-provisioned"
  _idep_pending="$_idep_gitdir/ensure-worktree-install-pending"

  # Take the lock before reading any provisioning state, not just before
  # writing. Every decision below — is this provisioned, is that pending marker
  # abandoned, does node_modules count as evidence — is a read that another
  # process can invalidate a moment later, so the checks have to be inside the
  # same exclusive section as the actions they authorize. On the common
  # already-provisioned path this costs one mkdir and one rmdir.
  _idep_locked=false
  if acquire_provisioning_lock "$_idep_gitdir/ensure-worktree-install.lock"; then
    _idep_locked=true
  fi

  # Already provisioned: leave it completely alone. No install, so nothing can
  # clobber a `bun link` or a hand-edited node_modules.
  [ -f "$_idep_marker" ] && return

  # A previous provisioning attempt got as far as putting files under
  # node_modules and never reached a successful install. Discard them and
  # start over.
  #
  # This has to be a marker on disk rather than cleanup on the failure path,
  # because the failure that matters is the one no handler runs for: SIGKILL,
  # a closed laptop, a power cut. What such an attempt leaves behind is a
  # node_modules that is COMPLETE — it is a clone of the reference tree — but
  # holds the reference branch's dependencies and was never reconciled against
  # this branch's lockfile. The backfill gate below reads any node_modules as
  # evidence someone installed here, so without this it would write the
  # provisioned marker over exactly that tree and skip the install forever.
  #
  # It supersedes cleaning up on the ordinary failure path: leaving the debris
  # for the retry to discard covers the graceful and the violent failure with
  # one rule. It also closes the same hazard for a tree bun itself half-wrote,
  # which previously survived into the backfill gate.
  if [ -f "$_idep_pending" ]; then
    # Recovering means deleting, which is only safe while nobody else can be
    # provisioning here. Unlocked, refuse rather than fall through: the backfill
    # gate below would read the interrupted clone as evidence of an install and
    # stamp it provisioned, which is the exact defect the pending marker exists
    # to prevent — and it would do so permanently, since every later run stops
    # at the provisioned gate. Leave the marker in place so a run that CAN lock
    # still repairs it.
    if [ "$_idep_locked" != true ]; then
      echo "ERROR [ensure-worktree]: '$_idep_wt' has an interrupted provisioning attempt to clean up, and this host has no way to lock it." >&2
      echo "  Install lockf(1) or flock(1) and re-run — that is the only path that repairs it here." >&2
      echo "  To clear it by hand instead, remove BOTH '$_idep_wt/node_modules' and" >&2
      echo "  '$_idep_pending'; removing only the first leaves this same refusal." >&2
      exit 1
    fi
    rm -rf "$_idep_wt/node_modules"
    rm -f "$_idep_pending"
  fi

  # Backfill the marker for a worktree that predates it. Without this, the
  # first run after this change treats every existing worktree as unprovisioned
  # and forces a frozen install on a tree whose manifests an agent may already
  # have edited — exiting 1 and withholding the path to the only copy of their
  # work. An existing node_modules is sufficient evidence that someone
  # installed here. Debris from a provisioning attempt this script itself
  # abandoned cannot reach here — the pending marker above removed it.
  if [ -d "$_idep_wt/node_modules" ]; then
    : >"$_idep_marker"
    return
  fi

  if ! command -v bun >/dev/null 2>&1; then
    echo "ERROR [ensure-worktree]: 'bun' is not on PATH; cannot provision '$_idep_wt'." >&2
    echo "  Install bun (see AGENTS.md) and re-run — this worktree has never been" >&2
    echo "  successfully provisioned, so re-running resumes where this left off." >&2
    exit 1
  fi

  # Claim the tree before writing a single byte into it, and hold the claim
  # until the install has actually succeeded. Anything that stops this script
  # in between — a failed install, a kill, a reboot — leaves the marker, and
  # the retry discards the tree instead of trusting it. The lock is what makes
  # that discard safe: it guarantees the marker cannot belong to a live peer.
  # Both are gated on the lock: the pending marker authorizes a destructive
  # recovery, which is only safe while nobody else can be provisioning here.
  if [ "$_idep_locked" = true ]; then
    : >"$_idep_pending"
    clone_node_modules "$_idep_wt"
  fi

  echo "[ensure-worktree] installing dependencies (bun install --frozen-lockfile)..." >&2
  if ! (cd "$_idep_wt" && bun install --frozen-lockfile >&2); then
    echo "ERROR [ensure-worktree]: 'bun install --frozen-lockfile' failed in '$_idep_wt'." >&2
    echo "  The lockfile does not match the manifests on this branch. Fix it and re-run;" >&2
    echo "  the worktree is left in place and re-running discards the partial" >&2
    echo "  node_modules and retries the install." >&2
    exit 1
  fi

  rm -f "$_idep_pending"
  : >"$_idep_marker"
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
  install_dependencies "$_wt_top"
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
  install_dependencies "$worktree_path"
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
install_dependencies "$worktree_path"

echo "$worktree_path"
