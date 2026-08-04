#!/usr/bin/env bash
# Map and review a feature branch from an isolated worktree with shared Clawpatch state.
#
# Usage:
#   scripts/clawpatch-review-branch.sh <branch-or-sha> [-- extra review flags]
#
# Example:
#   bun run clawpatch:review:branch -- codex/example-feature
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:?usage: clawpatch-review-branch.sh <branch-or-sha> [-- extra review flags]}"
shift

extra_args=()
if [[ $# -gt 0 ]]; then
  if [[ "${1:-}" != "--" ]]; then
    echo "usage: clawpatch-review-branch.sh <branch-or-sha> [-- extra review flags]" >&2
    exit 1
  fi
  shift
  extra_args=("$@")
fi

review_branch=""
review_branch_created=false
review_worktree=""
review_worktree_parent=""

cleanup_review_worktree() {
  if [[ -n "$review_worktree" && -d "$review_worktree" ]]; then
    # Route removal through the guard rather than a raw --force: the review
    # worktree is meant to be throwaway, so if the guard refuses, something
    # unexpected holds real work — leave the worktree in place and say so.
    # --throwaway because this script created the worktree minutes ago from
    # fetched state: the guard verifies locally and skips the per-submodule
    # ls-remote, so a network blip during the review cannot strand cleanup.
    if ! "$repo_root/scripts/remove-worktree.sh" --throwaway "$review_worktree" >&2; then
      echo "WARN [clawpatch-review-branch]: review worktree kept at $review_worktree — remove-worktree.sh refused (see above)." >&2
      review_worktree_parent=""
      return 0
    fi
  fi
  if [[ "$review_branch_created" == true && -n "$review_branch" ]]; then
    git -C "$repo_root" branch -D "$review_branch" >/dev/null 2>&1 || true
  fi
  if [[ -n "$review_worktree_parent" ]]; then
    rm -rf "$review_worktree_parent"
  fi
}
trap cleanup_review_worktree EXIT

looks_like_commit_sha() {
  [[ "$1" =~ ^[0-9a-fA-F]{7,40}$ ]]
}

resolve_target_sha() {
  local ref="$1" tmp_ref sha
  # A fresh fetch is the only trustworthy source for a remote branch; an
  # existing origin/<ref> tracking ref may be stale, so never use it without
  # a successful fetch backing it. Fetch into a unique temp ref rather than
  # reading FETCH_HEAD: FETCH_HEAD is one shared file per gitdir, rewritten
  # wholesale by ANY concurrent fetch in this checkout (a second review run,
  # an IDE background fetch), so a fetch-then-read of it can silently
  # resolve — and review — whatever commit the other fetch brought in.
  tmp_ref="refs/clawpatch-review/resolve-$$"
  if git -C "$repo_root" fetch origin "+refs/heads/${ref}:${tmp_ref}" >/dev/null 2>&1; then
    sha="$(git -C "$repo_root" rev-parse --verify "${tmp_ref}^{commit}" 2>/dev/null || true)"
    git -C "$repo_root" update-ref -d "$tmp_ref" >/dev/null 2>&1 || true
    if [[ -n "$sha" ]]; then
      printf '%s\n' "$sha"
      return 0
    fi
  fi
  # Local-only branches never exist on origin; a local head is authoritative.
  git -C "$repo_root" rev-parse --verify "refs/heads/${ref}^{commit}" 2>/dev/null && return 0

  return 1
}

slugify_ref() {
  local raw="$1"
  local slug
  slug="$(printf '%s' "$raw" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g' \
    | cut -c1-48)"
  if [[ -z "$slug" ]]; then
    slug="target"
  fi
  printf '%s' "$slug"
}

create_review_worktree() {
  local ref="$1"
  local sha="$2"
  local slug short_sha suffix
  slug="$(slugify_ref "$ref")"
  short_sha="$(git -C "$repo_root" rev-parse --short "$sha")"

  for attempt in {0..20}; do
    suffix=""
    if [[ "$attempt" -gt 0 ]]; then
      suffix="-$attempt"
    fi
    review_branch="review/${slug}-${short_sha}${suffix}"
    if ! git -C "$repo_root" show-ref --verify --quiet "refs/heads/$review_branch"; then
      break
    fi
  done

  if git -C "$repo_root" show-ref --verify --quiet "refs/heads/$review_branch"; then
    echo "ERROR [clawpatch-review-branch]: could not allocate a throwaway review branch for '$ref'." >&2
    review_branch=""
    exit 1
  fi

  review_worktree_parent="$(mktemp -d "${TMPDIR:-/tmp}/clawpatch-review-${slug}.XXXXXX")"
  review_worktree="$review_worktree_parent/worktree"
  git -C "$repo_root" worktree add -b "$review_branch" "$review_worktree" "$sha" >/dev/null
  review_branch_created=true
  # `git worktree add` leaves submodules unpopulated; reviewing a tree whose
  # libs/* are empty silently produces a report on a broken tree. Fail closed,
  # matching ensure-worktree.sh.
  if ! git -C "$review_worktree" submodule update --init --recursive >/dev/null; then
    echo "ERROR [clawpatch-review-branch]: could not initialize submodules in the review worktree." >&2
    exit 1
  fi
}

worktree=""
if looks_like_commit_sha "$target"; then
  # A hex-shaped target is always treated as a commit, never handed to
  # ensure-worktree.sh as a branch name (which would silently create a fresh
  # branch off origin/main and review the wrong diff).
  if ! git -C "$repo_root" cat-file -e "${target}^{commit}" 2>/dev/null; then
    git -C "$repo_root" fetch origin "$target" >/dev/null 2>&1 || true
  fi
  if ! git -C "$repo_root" cat-file -e "${target}^{commit}" 2>/dev/null; then
    echo "ERROR [clawpatch-review-branch]: '$target' looks like a commit SHA but cannot be resolved locally or fetched from origin." >&2
    exit 1
  fi
  target_sha="$(git -C "$repo_root" rev-parse --verify "${target}^{commit}")"
  create_review_worktree "$target" "$target_sha"
  worktree="$review_worktree"
else
  ensure_log="$(mktemp)"
  if worktree="$("$repo_root/scripts/ensure-worktree.sh" "$target" 2>"$ensure_log")"; then
    cat "$ensure_log" >&2
    rm -f "$ensure_log"
  else
    ensure_rc=$?
    ensure_error="$(cat "$ensure_log")"
    rm -f "$ensure_log"

    if target_sha="$(resolve_target_sha "$target")"; then
      if [[ -n "$ensure_error" ]]; then
        printf '%s\n' "$ensure_error" | sed 's/^/[clawpatch-review-branch] ensure-worktree failed; using throwaway review branch: /' >&2
      fi
      create_review_worktree "$target" "$target_sha"
      worktree="$review_worktree"
    else
      printf '%s\n' "$ensure_error" >&2
      exit "$ensure_rc"
    fi
  fi
fi

cd "$worktree"

# The review below diffs --since origin/main, and nothing above updates that
# tracking ref — the target-ref fetches are single-ref and leave origin/main
# wherever the last full fetch put it, silently scoping the review to the
# wrong range. Freshen it here; warn-only, because reviewing a local branch
# offline is still legitimate as long as the operator knows the base may lag.
if ! git -C "$repo_root" fetch origin '+refs/heads/main:refs/remotes/origin/main' >/dev/null 2>&1; then
  echo "WARN [clawpatch-review-branch]: could not fetch origin main — the review base origin/main may be stale." >&2
fi

"$repo_root/scripts/clawpatch.sh" map --source heuristic --json
"$repo_root/scripts/clawpatch.sh" review --since origin/main --json --no-input ${extra_args[@]+"${extra_args[@]}"}
