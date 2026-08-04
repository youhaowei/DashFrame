#!/usr/bin/env bash
# test-remove-worktree.sh — executable proof that the remove-worktree guard
# refuses on every data-loss path it documents, and removes when it should.
#
# Scenarios, each against the real script in a scratch repo with a real
# submodule and real (local-path) remotes:
#
#   1. clean worktree with a populated submodule       → removed
#   2. detached-HEAD commit in the worktree            → BLOCKED, branch fixes it
#   3. paused bisect with a clean tree                 → BLOCKED, reset fixes it
#   4. uncommitted file in the worktree                → BLOCKED
#   5. unpushed submodule commit behind a local tag    → BLOCKED
#   6. same commit published via a pushed tag only     → removed
#   7. unreachable submodule remote                    → BLOCKED (fail closed),
#      but --throwaway verifies locally               → removed
#   8. gitignored file (documented exemption)          → removed, file gone
#
# Run from the repo root:
#   scripts/test-remove-worktree.sh
#
# Exit 0 → all assertions pass; exit 1 → at least one failed.
set -u

REPO_ROOT="$(git rev-parse --show-toplevel)"
GUARD="$REPO_ROOT/scripts/remove-worktree.sh"

# All scratch git activity uses env-supplied config: identity for commits,
# and protocol.file.allow so submodules can clone from local paths (blocked
# by default since git 2.38). Nothing global is touched.
export GIT_CONFIG_COUNT=4
export GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always
export GIT_CONFIG_KEY_1=user.email GIT_CONFIG_VALUE_1=test@example.com
export GIT_CONFIG_KEY_2=user.name GIT_CONFIG_VALUE_2=Test
export GIT_CONFIG_KEY_3=commit.gpgsign GIT_CONFIG_VALUE_3=false

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
ok()   { printf "${GREEN}  ✓ %s${RESET}\n" "$*"; }
fail() { printf "${RED}  ✗ %s${RESET}\n" "$*"; FAILURES=$((FAILURES+1)); }
info() { printf "${YELLOW}  ▸ %s${RESET}\n" "$*"; }
FAILURES=0

SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
info "Scratch: $SCRATCH"

# ── fixtures: a submodule origin, a superproject origin, a main checkout ────
SUB_ORIGIN="$SCRATCH/sub-origin.git"
git init --quiet --bare "$SUB_ORIGIN"
sub_seed="$SCRATCH/sub-seed"
git init --quiet "$sub_seed"
git -C "$sub_seed" checkout -b main --quiet
printf 'sub\n' > "$sub_seed/sub.txt"
git -C "$sub_seed" add sub.txt
git -C "$sub_seed" commit -m "sub init" --quiet
git -C "$sub_seed" remote add origin "$SUB_ORIGIN"
git -C "$sub_seed" push --quiet origin main

ORIGIN="$SCRATCH/origin.git"
git init --quiet --bare "$ORIGIN"
REPO="$SCRATCH/repo"
git init --quiet "$REPO"
git -C "$REPO" checkout -b main --quiet
printf 'r1\n' > "$REPO/a.txt"; git -C "$REPO" add a.txt
git -C "$REPO" commit -m "c1" --quiet
printf 'r2\n' >> "$REPO/a.txt"; git -C "$REPO" add a.txt
git -C "$REPO" commit -m "c2" --quiet
git -C "$REPO" submodule add --quiet "$SUB_ORIGIN" libs/sub 2>/dev/null
printf '.env\n' > "$REPO/.gitignore"; git -C "$REPO" add .gitignore
git -C "$REPO" commit -m "c3: add submodule + ignore .env" --quiet
# Two commits after the submodule exists, so a bisect over c3..c5 never
# checks out a tree without the gitlink (which would strand untracked
# submodule content and break `bisect reset`).
printf 'r4\n' >> "$REPO/a.txt"; git -C "$REPO" add a.txt
git -C "$REPO" commit -m "c4" --quiet
printf 'r5\n' >> "$REPO/a.txt"; git -C "$REPO" add a.txt
git -C "$REPO" commit -m "c5" --quiet
git -C "$REPO" remote add origin "$ORIGIN"
git -C "$REPO" push --quiet origin main

# make_wt <name> <branch> — worktree with the submodule populated. echoes path.
make_wt() {
  local path="$SCRATCH/$1"
  git -C "$REPO" worktree add "$path" -b "$2" --quiet >/dev/null 2>&1
  git -C "$path" submodule update --init --quiet >/dev/null 2>&1
  printf '%s' "$path"
}
# run_guard [flags...] <path> — capture combined output, set GUARD_RC/GUARD_OUT.
run_guard() {
  GUARD_OUT=$("$GUARD" "$@" 2>&1); GUARD_RC=$?
}
# assert_blocked <path> <pattern> <label> — guard refuses AND worktree survives.
assert_blocked() {
  local path="$1" pattern="$2" label="$3"
  if [ "$GUARD_RC" -ne 0 ] && printf '%s' "$GUARD_OUT" | grep -q "$pattern" && [ -d "$path" ]; then
    ok "$label"
  else
    fail "$label (rc=$GUARD_RC, out: $(printf '%s' "$GUARD_OUT" | head -4))"
  fi
}
assert_removed() {
  local path="$1" label="$2"
  if [ "$GUARD_RC" -eq 0 ] && [ ! -d "$path" ]; then
    ok "$label"
  else
    fail "$label (rc=$GUARD_RC, out: $(printf '%s' "$GUARD_OUT" | head -4))"
  fi
}
echo ""

echo "Test 1: clean worktree with populated submodule → removed"
WT=$(make_wt wt1 t1)
run_guard "$WT"
assert_removed "$WT" "clean worktree removed (rc 0, directory gone)"
echo ""

echo "Test 2: detached-HEAD commit → blocked; a branch makes it removable"
WT="$SCRATCH/wt2"
git -C "$REPO" worktree add --detach "$WT" HEAD --quiet >/dev/null 2>&1
git -C "$WT" submodule update --init --quiet >/dev/null 2>&1
printf 'detached\n' > "$WT/d.txt"
git -C "$WT" add d.txt
git -C "$WT" commit -m "detached work" --quiet
run_guard "$WT"
assert_blocked "$WT" "reachable only from its own HEAD" "detached-HEAD commit blocks removal"
git -C "$WT" branch keep-detached --quiet
run_guard "$WT"
assert_removed "$WT" "after 'git branch', the same worktree is removable"
git -C "$REPO" branch -D keep-detached --quiet 2>/dev/null
echo ""

echo "Test 3: paused bisect with a clean tree → blocked; reset fixes it"
WT=$(make_wt wt3 t3)
git -C "$WT" bisect start >/dev/null 2>&1
git -C "$WT" bisect bad HEAD >/dev/null 2>&1
git -C "$WT" bisect good HEAD~2 >/dev/null 2>&1
wt_gitdir=$(git -C "$WT" rev-parse --absolute-git-dir)
if [ -e "$wt_gitdir/BISECT_LOG" ]; then
  ok "fixture: bisect state present in the per-worktree gitdir"
else
  fail "fixture: bisect did not leave BISECT_LOG — test cannot bite"
fi
run_guard "$WT"
assert_blocked "$WT" "operation is in progress" "paused bisect blocks removal"
git -C "$WT" bisect reset >/dev/null 2>&1
git -C "$WT" submodule update --init --quiet >/dev/null 2>&1  # bisect reset may move HEAD
run_guard "$WT"
assert_removed "$WT" "after 'git bisect reset', the worktree is removable"
echo ""

echo "Test 4: uncommitted file in the worktree → blocked"
WT=$(make_wt wt4 t4)
printf 'wip\n' > "$WT/wip.txt"
run_guard "$WT"
assert_blocked "$WT" "uncommitted or untracked files" "untracked file blocks removal"
rm "$WT/wip.txt"
run_guard "$WT"
assert_removed "$WT" "after removing the file, the worktree is removable"
echo ""

echo "Test 5: unpushed submodule commit behind a local tag → blocked"
WT=$(make_wt wt5 t5)
printf 'local\n' > "$WT/libs/sub/local.txt"
git -C "$WT/libs/sub" add local.txt
git -C "$WT/libs/sub" commit -m "local sub work" --quiet
git -C "$WT/libs/sub" tag local-only
# Re-record the pointer so pointer-drift doesn't fire first: commit the bump.
git -C "$WT" add libs/sub
git -C "$WT" commit -m "bump sub" --quiet
run_guard "$WT"
assert_blocked "$WT" "commits no remote has" "local tag does not hide an unpushed submodule commit"
echo ""

echo "Test 6: the same commit published via a pushed tag only → removed"
git -C "$WT/libs/sub" push --quiet origin local-only
run_guard "$WT"
if [ "$GUARD_RC" -eq 0 ] && [ ! -d "$WT" ]; then
  ok "pushed tag makes the submodule commit count as published"
else
  # The superproject branch t5 holds the bump commit locally only — but the
  # superproject check is reachability, and t5 is a local branch, so only
  # the submodule verdict decides here.
  fail "pushed-tag-only publication not recognized (rc=$GUARD_RC, out: $(printf '%s' "$GUARD_OUT" | head -4))"
fi
echo ""

echo "Test 7: unreachable submodule remote → fail closed; --throwaway verifies locally"
WT=$(make_wt wt7 t7)
git -C "$WT/libs/sub" remote set-url origin "$SCRATCH/no-such-remote.git"
run_guard "$WT"
assert_blocked "$WT" "cannot reach any remote" "dead remote fails closed in default mode"
run_guard --throwaway "$WT"
assert_removed "$WT" "--throwaway removes it offline via local containment"
echo ""

echo "Test 8: gitignored file is a documented exemption → removed, file discarded"
WT=$(make_wt wt8 t8)
printf 'SECRET=1\n' > "$WT/.env"
run_guard "$WT"
assert_removed "$WT" "gitignored .env does not block (removal discards it, per the header)"
echo ""

if [ "$FAILURES" -eq 0 ]; then
  printf "${GREEN}All tests passed — remove-worktree guard is working.${RESET}\n"
  exit 0
else
  printf "${RED}$FAILURES test(s) failed — guard is NOT working as expected.${RESET}\n"
  exit 1
fi
