#!/usr/bin/env bash
# Repo-local Clawpatch wrapper: shared state outside any single worktree.
#
# Reliable workflow (from repo root):
#   bun run clawpatch:review:branch -- <branch>     # map + review in worktree
#   CLAWPATCH_STATE_DIR=~/.local/state/clawpatch/dashframe bun run clawpatch:map
#   cd <worktree> && bun run clawpatch:review
#
# State dir: CLAWPATCH_STATE_DIR → XDG_STATE_HOME → ~/.local/state → /tmp fallback.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
git_dir=$(git rev-parse --path-format=absolute --git-common-dir)
main_root=$(dirname "$git_dir")
project_name="$(basename "$main_root")-$(printf '%s' "$git_dir" | cksum | cut -d' ' -f1)"

# Parse explicit --state-dir (or -s) from caller args before any default/pre-flight init
state_dir_from_arg=""
parse_args=("$@")
while [[ ${#parse_args[@]} -gt 0 ]]; do
  arg="${parse_args[0]}"
  parse_args=("${parse_args[@]:1}")
  if [[ "$arg" == "--state-dir" && ${#parse_args[@]} -gt 0 ]]; then
    state_dir_from_arg="${parse_args[0]}"; break
  elif [[ "$arg" == --state-dir=* ]]; then
    state_dir_from_arg="${arg#*=}"; break
  elif [[ "$arg" == "-s" && ${#parse_args[@]} -gt 0 ]]; then
    state_dir_from_arg="${parse_args[0]}"; break
  elif [[ "$arg" == -s=* ]]; then
    state_dir_from_arg="${arg#*=}"; break
  fi
done
if [[ -n "$state_dir_from_arg" ]]; then
  state_dir="$state_dir_from_arg"
elif [[ -n "${CLAWPATCH_STATE_DIR:-}" ]]; then
  state_dir="$CLAWPATCH_STATE_DIR"
elif [[ -n "${XDG_STATE_HOME:-}" ]]; then
  preferred_state_dir="${XDG_STATE_HOME}/clawpatch/$project_name"
  if mkdir -p "$preferred_state_dir" 2>/dev/null; then
    state_dir="$preferred_state_dir"
  else
    state_dir="${TMPDIR:-/tmp}/clawpatch-state/$project_name"
  fi
elif [[ -n "${HOME:-}" ]]; then
  preferred_state_dir="${HOME}/.local/state/clawpatch/$project_name"
  if mkdir -p "$preferred_state_dir" 2>/dev/null; then
    state_dir="$preferred_state_dir"
  else
    state_dir="${TMPDIR:-/tmp}/clawpatch-state/$project_name"
  fi
else
  state_dir="${TMPDIR:-/tmp}/clawpatch-state/$project_name"
fi

mkdir -p "$state_dir"

if [[ ! -f "$state_dir/project.json" && -f "$repo_root/.clawpatch/project.json" ]]; then
  cp -R "$repo_root/.clawpatch/." "$state_dir/"
fi

if [[ ! -f "$state_dir/project.json" ]]; then
  clawpatch --state-dir "$state_dir" init --json >/dev/null
fi

if [[ $# -eq 0 ]]; then
  set -- status --json
fi

if [[ "$1" == "review" ]]; then
  shift
  has_jobs=false
  for arg in "$@"; do
    if [[ "$arg" == "--jobs" || "$arg" == --jobs=* || "$arg" == "-j" ]]; then
      has_jobs=true
      break
    fi
  done

  if [[ "$has_jobs" == false ]]; then
    set -- review --jobs 1 "$@"
  else
    set -- review "$@"
  fi
fi

if [[ "${1:-}" == "review" ]]; then
  since_base=""
  previous_arg=""
  for arg in "$@"; do
    if [[ "$previous_arg" == "--since" ]]; then
      since_base="$arg"
      break
    fi
    if [[ "$arg" == --since=* ]]; then
      since_base="${arg#--since=}"
      break
    fi
    previous_arg="$arg"
  done

  review_stdout_file="$(mktemp)"
  review_stderr_file="$(mktemp)"
  set +e
  clawpatch --state-dir "$state_dir" "$@" >"$review_stdout_file" 2>"$review_stderr_file"
  review_rc=$?
  set -e
  review_stdout="$(cat "$review_stdout_file")"
  review_stderr="$(cat "$review_stderr_file")"
  rm -f "$review_stdout_file" "$review_stderr_file"
  if [[ -n "$review_stdout" ]]; then
    printf '%s\n' "$review_stdout"
  fi
  if [[ -n "$review_stderr" ]]; then
    printf '%s\n' "$review_stderr" >&2
  fi

  if [[ "$review_rc" -eq 0 && -n "$since_base" ]] \
    && grep -Fq "no features touched by diff" <<<"${review_stdout}${review_stderr}"; then
    changed_files="$(git diff --name-only "$since_base" -- || true)"
    if [[ -n "$changed_files" ]]; then
      echo "ERROR [clawpatch]: stale map / unmapped files: review reported no features touched by diff, but git diff --name-only '$since_base' is non-empty." >&2
      echo "ERROR [clawpatch]: run scripts/clawpatch.sh map --source heuristic and check whether changed files are mapped to features." >&2
      exit 1
    fi
  fi

  exit "$review_rc"
fi

clawpatch --state-dir "$state_dir" "$@"
