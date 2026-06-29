#!/usr/bin/env bash
# Map and review a feature branch from an isolated worktree with shared Clawpatch state.
#
# Usage:
#   scripts/clawpatch-review-branch.sh <branch> [-- extra review flags]
#
# Example:
#   bun run clawpatch:review:branch -- codex/YW-134-perception-assembler
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
branch="${1:?usage: clawpatch-review-branch.sh <branch> [-- extra review flags]}"
shift

extra_args=()
if [[ $# -gt 0 ]]; then
  if [[ "${1:-}" != "--" ]]; then
    echo "usage: clawpatch-review-branch.sh <branch> [-- extra review flags]" >&2
    exit 1
  fi
  shift
  extra_args=("$@")
fi

worktree="$("$repo_root/scripts/ensure-worktree.sh" "$branch")"
cd "$worktree"

"$worktree/scripts/clawpatch.sh" map --source heuristic --json
exec "$worktree/scripts/clawpatch.sh" review --since origin/main --json --no-input "${extra_args[@]}"
