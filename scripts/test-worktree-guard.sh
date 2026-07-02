#!/usr/bin/env sh
# test-worktree-guard.sh — demonstrate and verify the worktree isolation guard
#
# This script is the executable proof that the guard works (acceptance criterion 3).
# It runs three scenarios against the actual hooks in a temporary scratch repo:
#
#   PASS 1: commit on main-branch in main checkout  → allowed
#   PASS 2: commit from an isolated worktree         → allowed
#   PASS 3: commit on feature-branch in main checkout → BLOCKED by hook
#   PASS 4: bypass env-var lifts the block            → allowed with warning
#
# Run from the repo root:
#   scripts/test-worktree-guard.sh
#
# Exit 0  → all assertions pass (guard works correctly)
# Exit 1  → at least one assertion failed

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
GUARD_HOOK="$REPO_ROOT/.husky/pre-commit"

# ── colour helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
ok()   { printf "${GREEN}  ✓ %s${RESET}\n" "$*"; }
fail() { printf "${RED}  ✗ %s${RESET}\n" "$*"; FAILURES=$((FAILURES+1)); }
info() { printf "${YELLOW}  ▸ %s${RESET}\n" "$*"; }

FAILURES=0

# ── scratch repo setup ───────────────────────────────────────────────────────
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT

cd "$SCRATCH"
git init --quiet
git config user.email "test@example.com"
git config user.name "Test"
git config commit.gpgsign false 2>/dev/null || true
git remote add origin "https://example.com/repo.git"

# Fake an origin/HEAD → main so the guard can detect the default branch.
git checkout -b main --quiet
# Create an initial commit so HEAD is valid.
printf 'initial\n' > README.txt
git add README.txt
# Commit WITHOUT the guard hook first (bootstrap).
git commit --no-verify -m "init" --quiet

# Point origin/HEAD at main.
git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main 2>/dev/null || true

# Install only the worktree guard section of the hook (not lint-staged which
# isn't installed in the scratch repo).  We extract the guard block using the
# sentinels embedded in the hook — this is robust to reordering of hook sections.
awk '/── Worktree isolation guard/{f=1} /── end guard ──/{f=0} f' "$GUARD_HOOK" > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

info "Scratch repo: $SCRATCH"
echo ""

# ── Test 1: main branch in main checkout → ALLOWED ──────────────────────────
echo "Test 1: commit on 'main' in main checkout (should be allowed)"
printf 'change1\n' > f1.txt; git add f1.txt
if git commit -m "test1" --quiet 2>/dev/null; then
  ok "commit allowed on default branch in main checkout"
else
  fail "commit was unexpectedly blocked on the default branch"
fi
echo ""

# ── Test 2: commit from an isolated worktree → ALLOWED ──────────────────────
echo "Test 2: commit from an isolated worktree (should be allowed)"
WORKTREE_DIR="$SCRATCH/wt-feature"
git worktree add "$WORKTREE_DIR" -b feature-a --quiet 2>/dev/null
cd "$WORKTREE_DIR"
printf 'wt-change\n' > wt.txt; git add wt.txt
if git commit -m "worktree-commit" --quiet 2>/dev/null; then
  ok "commit allowed from isolated worktree"
else
  fail "commit was unexpectedly blocked in a worktree"
fi
cd "$SCRATCH"
echo ""

# ── Test 3: feature branch in main checkout → BLOCKED ───────────────────────
echo "Test 3: commit on feature branch in main checkout (should be BLOCKED)"
git checkout -b feature-b --quiet 2>/dev/null
printf 'main-checkout-change\n' > f2.txt; git add f2.txt
# Capture stderr; verify that the guard's signature text appears, not just any
# non-zero exit (which could be a hook syntax error or an unrelated failure).
_commit_stderr=$(git commit -m "should-fail" 2>&1 >/dev/null || true)
if echo "$_commit_stderr" | grep -q "WORKTREE ISOLATION GUARD"; then
  ok "hook blocked the commit with the isolation guard message"
else
  # If git commit exited 0, the guard failed to block.  If it exited non-zero
  # but for a different reason, the guard is not the one firing.
  if git log --oneline -1 2>/dev/null | grep -q "should-fail"; then
    fail "hook did NOT block the commit — guard is broken (commit landed)"
  else
    fail "commit was blocked but the guard signature was missing — check hook logic (stderr: $(printf '%s' "$_commit_stderr" | head -3))"
  fi
fi
git checkout main --quiet 2>/dev/null
# Clean up staged file.
git checkout -- . 2>/dev/null || true
git branch -D feature-b --quiet 2>/dev/null || true
echo ""

# ── Test 4: bypass env-var allows the commit ────────────────────────────────
echo "Test 4: ALLOW_MAIN_CHECKOUT_COMMIT=1 bypasses the block (should be allowed)"
git checkout -b feature-c --quiet 2>/dev/null
printf 'bypass-test\n' > f3.txt; git add f3.txt
# Show stderr (the bypass warning) and verify the commit lands.
if ALLOW_MAIN_CHECKOUT_COMMIT=1 git commit -m "bypass-test" --quiet; then
  ok "bypass env-var lifted the block"
else
  fail "bypass env-var did not work — check hook logic"
fi
git checkout main --quiet 2>/dev/null
git branch -D feature-c --quiet 2>/dev/null || true
echo ""

# ── ensure-worktree.sh tests ─────────────────────────────────────────────────
HELPER="$REPO_ROOT/scripts/ensure-worktree.sh"
cd "$SCRATCH"

echo "Test 5: ensure-worktree.sh without argument → exits non-zero"
if "$HELPER" 2>/dev/null; then
  fail "should have required a branch argument"
else
  ok "rejected missing branch argument"
fi
echo ""

echo "Test 6: ensure-worktree.sh from main checkout provisions a worktree"
git checkout main --quiet 2>/dev/null
# Ensure the branch exists locally so the helper can create a worktree for it.
git checkout -b feature-d --quiet 2>/dev/null
git checkout main --quiet 2>/dev/null
result=$(WORKTREE_BASE="$SCRATCH/wt-out" "$HELPER" feature-d 2>/dev/null) || true
if [ -d "$result" ] && git -C "$result" rev-parse --verify HEAD >/dev/null 2>&1; then
  ok "worktree provisioned at: $result"
  actual_branch=$(git -C "$result" rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ "$actual_branch" = "feature-d" ]; then
    ok "worktree is on the correct branch (feature-d)"
  else
    fail "worktree is on '$actual_branch', expected 'feature-d'"
  fi
else
  fail "ensure-worktree.sh did not produce a valid worktree path (got: '$result')"
fi
echo ""

echo "Test 7: ensure-worktree.sh from an existing worktree → returns current path"
WTP="$SCRATCH/wt-out/feature-d"
if [ ! -d "$WTP" ]; then
  # Test 6 failed to provision the worktree — make that explicit so FAILURES increments.
  fail "Test 7 prerequisite missing: worktree '$WTP' was not created by Test 6"
else
  cd "$WTP"
  returned=$(WORKTREE_BASE="$SCRATCH/wt-out" "$HELPER" feature-d 2>/dev/null) || true
  # Resolve symlinks before comparing: macOS /var → /private/var etc.
  canon_expected=$(cd "$WTP" && pwd -P)
  canon_returned=$(cd "$returned" 2>/dev/null && pwd -P || echo "$returned")
  if [ "$canon_returned" = "$canon_expected" ]; then
    ok "already-in-worktree case returned the correct path"
  else
    fail "expected '$canon_expected', got '$canon_returned'"
  fi
  cd "$SCRATCH"
fi
echo ""

# ── Regression: main checkout must never be mutated ─────────────────────────
# ensure-worktree.sh used to instruct the caller to run `git checkout -b
# <branch>` in the main checkout when the branch didn't exist anywhere yet —
# mutating the main checkout's HEAD/branch out from under whoever else was
# using it. Assert the main checkout is untouched by a provisioning call,
# both for the "branch already exists locally" path (exercised above) and
# the brand-new-branch path.
echo "Test 8: ensure-worktree.sh never mutates the main checkout's HEAD/branch"
cd "$SCRATCH"
git checkout main --quiet 2>/dev/null
main_head_before=$(git rev-parse HEAD)
main_branch_before=$(git branch --show-current)

# 8a: provisioning for a branch that already exists locally (feature-e).
git checkout -b feature-e --quiet 2>/dev/null
git checkout main --quiet 2>/dev/null
feature_e_rc=0
feature_e_result=$(WORKTREE_BASE="$SCRATCH/wt-out2" "$HELPER" feature-e 2>/dev/null) || feature_e_rc=$?
if [ "$feature_e_rc" -eq 0 ] && [ -d "$feature_e_result" ] && git -C "$feature_e_result" rev-parse --verify HEAD >/dev/null 2>&1; then
  ok "helper provisioned feature-e successfully (exit 0, valid checkout at $feature_e_result)"
else
  fail "helper did not provision feature-e as expected (exit $feature_e_rc, result '$feature_e_result')"
fi
main_head_after=$(git rev-parse HEAD)
main_branch_after=$(git branch --show-current)
if [ "$main_head_after" = "$main_head_before" ] && [ "$main_branch_after" = "$main_branch_before" ]; then
  ok "main checkout unchanged after provisioning an existing branch"
else
  fail "main checkout mutated: HEAD $main_head_before -> $main_head_after, branch $main_branch_before -> $main_branch_after"
fi

# 8b: requesting a branch when 'origin' itself is unreachable (this scratch
# repo's 'origin' remote is a deliberately unfetchable URL, so `git
# ls-remote` fails with a network-error exit code, not the "no matching
# ref" exit code 2). This must be treated as a remote-lookup FAILURE — fail
# closed with a diagnostic naming that distinction — not misread as
# "confirmed absent, fall back to branching from main". It must also never
# touch the main checkout.
nonexistent_rc=0
nonexistent_stderr=$(WORKTREE_BASE="$SCRATCH/wt-out2b" "$HELPER" totally-nonexistent-branch 2>&1 >/dev/null) || nonexistent_rc=$?
main_head_after2=$(git rev-parse HEAD)
main_branch_after2=$(git branch --show-current)
if [ "$nonexistent_rc" -ne 0 ]; then
  ok "unresolvable-origin branch request fails closed (exit $nonexistent_rc)"
else
  fail "unresolvable-origin branch request unexpectedly succeeded"
fi
if printf '%s' "$nonexistent_stderr" | grep -q "network or auth problem reaching 'origin'"; then
  ok "failure message correctly identifies a remote lookup failure, not a confirmed-missing branch"
else
  fail "expected a remote-lookup-failure diagnostic, got: $nonexistent_stderr"
fi
if [ "$main_head_after2" = "$main_head_before" ] && [ "$main_branch_after2" = "$main_branch_before" ]; then
  ok "main checkout unchanged after an unresolvable-origin branch request"
else
  fail "main checkout mutated on unresolvable-origin branch: HEAD $main_head_before -> $main_head_after2, branch $main_branch_before -> $main_branch_after2"
fi
echo ""

# ── Test 9: brand-new branch created atomically from a real, fetchable origin/main ──
# The scratch repo's 'origin' remote (https://example.com/repo.git) is
# deliberately unreachable so Test 8b can exercise the "lookup failed"
# path. Exercise the success path separately against a real local bare
# repo standing in for a fetchable 'origin', proving the new branch is
# created directly from origin/main, does NOT track main (avoiding a
# broken first push/pull), and — again — never touches the main checkout.
echo "Test 9: ensure-worktree.sh creates a brand-new branch atomically from origin/main"
FAKE_ORIGIN="$SCRATCH/fake-origin.git"
git init --quiet --bare "$FAKE_ORIGIN"

REAL_ORIGIN_REPO="$SCRATCH/real-origin-checkout"
git init --quiet "$REAL_ORIGIN_REPO"
(
  cd "$REAL_ORIGIN_REPO"
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false 2>/dev/null || true
  git checkout -b main --quiet
  printf 'origin-main\n' > origin-main.txt
  git add origin-main.txt
  git commit -m "origin main" --quiet
  git remote add origin "$FAKE_ORIGIN"
  git push --quiet origin main
)

cd "$SCRATCH"
git remote set-url origin "$FAKE_ORIGIN"
git fetch --quiet origin main
origin_main_sha=$(git rev-parse origin/main)

new_branch_rc=0
new_branch_result=$(WORKTREE_BASE="$SCRATCH/wt-out3" "$HELPER" brand-new-from-origin-main 2>/dev/null) || new_branch_rc=$?
if [ "$new_branch_rc" -eq 0 ] && [ -d "$new_branch_result" ]; then
  ok "helper created the new branch's worktree (exit 0, at $new_branch_result)"
else
  fail "helper did not create the new-branch worktree as expected (exit $new_branch_rc, result '$new_branch_result')"
fi
new_branch_actual=$(git -C "$new_branch_result" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ "$new_branch_actual" = "brand-new-from-origin-main" ]; then
  ok "new worktree is on the requested branch"
else
  fail "new worktree is on '$new_branch_actual', expected 'brand-new-from-origin-main'"
fi
new_branch_sha=$(git -C "$new_branch_result" rev-parse HEAD 2>/dev/null || echo "")
if [ "$new_branch_sha" = "$origin_main_sha" ]; then
  ok "new branch is rooted at origin/main's commit ($origin_main_sha)"
else
  fail "new branch HEAD ($new_branch_sha) does not match origin/main ($origin_main_sha)"
fi
new_branch_upstream=$(git -C "$new_branch_result" rev-parse --abbrev-ref "brand-new-from-origin-main@{upstream}" 2>/dev/null || echo "")
if [ -z "$new_branch_upstream" ]; then
  ok "new branch does not track origin/main (--no-track honoured, no broken upstream)"
else
  fail "new branch unexpectedly tracks '$new_branch_upstream' — first push/pull would target the wrong branch"
fi

main_head_after3=$(git rev-parse HEAD)
main_branch_after3=$(git branch --show-current)
if [ "$main_head_after3" = "$main_head_before" ] && [ "$main_branch_after3" = "$main_branch_before" ]; then
  ok "main checkout unchanged after creating a brand-new branch from origin/main"
else
  fail "main checkout mutated on new-branch creation: HEAD $main_head_before -> $main_head_after3, branch $main_branch_before -> $main_branch_after3"
fi
echo ""

# ── Summary ──────────────────────────────────────────────────────────────────
if [ "$FAILURES" -eq 0 ]; then
  printf "${GREEN}All tests passed — worktree isolation guard is working.${RESET}\n"
  exit 0
else
  printf "${RED}$FAILURES test(s) failed — guard is NOT working as expected.${RESET}\n"
  exit 1
fi
