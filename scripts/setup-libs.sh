#!/usr/bin/env bash
# Link (dev) or clone (CI) the sibling libraries pinned in libs.lock.
#
# Dev (default): symlink libs/<name> -> $LIBS_DIR/<name>, a real checkout you
# edit in its own repo. If the sibling checkout doesn't exist yet it is cloned
# and checked out at the pin. Warns when the sibling's HEAD differs from the
# pin — the pin records what CI builds against; the symlink is what you run
# locally.
# CI (--ci): fetch each repo at exactly the pinned sha into libs/<name>.
set -euo pipefail
cd "$(dirname "$0")/.."
LIBS_DIR="${LIBS_DIR:-$HOME/Projects}"
case "${1:-}" in
  '') MODE=dev ;;
  --ci) MODE=ci ;;
  *) echo "setup-libs: unknown argument: $1 (expected no argument or --ci)" >&2; exit 2 ;;
esac
mkdir -p libs
while IFS=$'\t' read -r name repo sha || [ -n "${name:-}" ]; do
  case "$name" in ''|\#*) continue ;; esac
  # Validate each row before acting on it: a malformed name could escape
  # libs/ via rm -rf, and a CRLF line ending or truncated sha would fail
  # later with a confusing git error.
  case "$name" in
    *[!A-Za-z0-9._-]*) echo "setup-libs: invalid library name in libs.lock: '$name'" >&2; exit 2 ;;
  esac
  case "$repo" in
    https://*) ;;
    *) echo "setup-libs: repo for '$name' must be an https:// URL, got: '$repo'" >&2; exit 2 ;;
  esac
  case "$sha" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) [ "${#sha}" -eq 40 ] || { echo "setup-libs: sha for '$name' is not 40 hex chars: '$sha'" >&2; exit 2; } ;;
    *) echo "setup-libs: sha for '$name' is not 40 hex chars: '$sha'" >&2; exit 2 ;;
  esac
  if [ "$MODE" = ci ]; then
    rm -rf "libs/$name"
    git init -q "libs/$name"
    git -C "libs/$name" fetch -q --depth 1 "$repo" "$sha" || {
      echo "setup-libs: cannot fetch $name@${sha:0:7} from $repo" >&2
      echo "  (is the pinned commit pushed? library changes must land in the" >&2
      echo "   library's remote before a consumer pin can reference them)" >&2
      exit 1
    }
    git -C "libs/$name" checkout -q FETCH_HEAD
  else
    src="$LIBS_DIR/$name"
    if [ ! -d "$src" ]; then
      echo "setup-libs: sibling checkout missing, cloning $repo -> $src" >&2
      git clone "$repo" "$src"
      git -C "$src" checkout -q "$sha"
    fi
    if [ -d "libs/$name" ] && [ ! -L "libs/$name" ]; then
      # A leftover submodule working directory may hold uncommitted work —
      # never delete it automatically. A plain directory (left by a --ci
      # run) is disposable: ln -sfn would otherwise nest the link inside it.
      if [ -e "libs/$name/.git" ]; then
        echo "setup-libs: libs/$name is a git checkout (old submodule?); move it aside first" >&2
        exit 1
      fi
      rm -rf "libs/$name"
    fi
    ln -sfn "$src" "libs/$name"
    head="$(git -C "$src" rev-parse HEAD)"
    [ "$head" = "$sha" ] || {
      echo "setup-libs: drift: $name sibling at ${head:0:7}, pin is ${sha:0:7}" >&2
      echo "  (if install or typecheck fails, this drift is the first suspect:" >&2
      echo "   sync the sibling toward the pin, or bump the pin in libs.lock)" >&2
    }
  fi
done < libs.lock
