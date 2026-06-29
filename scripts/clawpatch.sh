#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
project_name="$(basename "$repo_root")"

if [[ -n "${CLAWPATCH_STATE_DIR:-}" ]]; then
  state_dir="$CLAWPATCH_STATE_DIR"
else
  user_state_home="${XDG_STATE_HOME:-"$HOME/.local/state"}"
  preferred_state_dir="$user_state_home/clawpatch/$project_name"
  if mkdir -p "$preferred_state_dir" 2>/dev/null; then
    state_dir="$preferred_state_dir"
  else
    state_dir="${TMPDIR:-/tmp}/clawpatch-state/$project_name"
  fi
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
    if [[ "$arg" == "--jobs" || "$arg" == --jobs=* ]]; then
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

clawpatch --state-dir "$state_dir" "$@"
