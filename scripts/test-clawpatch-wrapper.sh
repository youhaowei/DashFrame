#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

mkdir -p "$scratch/bin" "$scratch/state"
touch "$scratch/state/project.json"

cat >"$scratch/bin/clawpatch" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

state_dir=""
if [[ "${1:-}" == "--state-dir" ]]; then
  state_dir="$2"
  shift 2
fi

case "${1:-}" in
  review)
    if [[ ! -f "$state_dir/retried" ]]; then
      printf '{"next":"no features touched by diff"}\n'
    else
      printf '{"reviewed":1,"findings":0}\n'
    fi
    ;;
  status)
    if [[ -f "$state_dir/converged" ]]; then
      printf '{"activeLocks":0,"lockFiles":0}\n'
    else
      printf '{"activeLocks":1,"lockFiles":0}\n'
    fi
    ;;
  clean-locks)
    touch "$state_dir/retried"
    printf '{"cleared":1,"lockFilesCleared":0}\n'
    ;;
  *)
    printf 'unexpected command: %s\n' "${1:-}" >&2
    exit 2
    ;;
esac
EOF
chmod +x "$scratch/bin/clawpatch"

git init --quiet "$scratch/repo"
git -C "$scratch/repo" config user.email test@example.com
git -C "$scratch/repo" config user.name Test
git -C "$scratch/repo" checkout -b main --quiet
printf 'base\n' >"$scratch/repo/file.txt"
git -C "$scratch/repo" add file.txt
git -C "$scratch/repo" commit --quiet -m base
git -C "$scratch/repo" branch origin/main
printf 'changed\n' >>"$scratch/repo/file.txt"

output="$(
  cd "$scratch/repo"
  PATH="$scratch/bin:$PATH" \
    CLAWPATCH_STATE_DIR="$scratch/state" \
    "$repo_root/scripts/clawpatch.sh" review --since origin/main --json --no-input --limit 1 2>&1
)"

grep -Fq 'clearing orphaned feature locks and retrying review once' <<<"$output"
grep -Fq '"reviewed":1' <<<"$output"
test -f "$scratch/state/retried"

printf 'clawpatch wrapper stale-lock recovery: pass\n'

rm -f "$scratch/state/retried"
touch "$scratch/state/converged"
mkdir -p "$scratch/state/features"
cat >"$scratch/state/features/feature.json" <<'EOF'
{"ownedFiles":[{"path": "file.ts"}]}
EOF
mv "$scratch/repo/file.txt" "$scratch/repo/file.ts"
git -C "$scratch/repo" add file.txt file.ts

output="$(
  cd "$scratch/repo"
  PATH="$scratch/bin:$PATH" \
    CLAWPATCH_STATE_DIR="$scratch/state" \
    "$repo_root/scripts/clawpatch.sh" review --since origin/main --json --no-input --limit 1 2>&1
)"

grep -Fq 'diff is mapped; no eligible features remain to review' <<<"$output"
printf 'clawpatch wrapper converged-review handling: pass\n'

printf 'unmapped\n' >"$scratch/repo/unmapped.ts"
git -C "$scratch/repo" add unmapped.ts
if (
  cd "$scratch/repo"
  PATH="$scratch/bin:$PATH" \
    CLAWPATCH_STATE_DIR="$scratch/state" \
    "$repo_root/scripts/clawpatch.sh" review --since origin/main --json --no-input --limit 1
) >"$scratch/unmapped.out" 2>&1; then
  printf 'expected unmapped reviewable file to fail\n' >&2
  exit 1
fi

grep -Fq 'unmapped.ts' "$scratch/unmapped.out"
printf 'clawpatch wrapper unmapped-file guard: pass\n'
