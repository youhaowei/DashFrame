#!/usr/bin/env bash
# Link (dev) or clone (CI) the sibling libraries pinned in libs.lock.
#
# Dev (default): symlink libs/<name> -> $LIBS_DIR/<name>, a real checkout you
# edit in its own repo. Warns when the sibling's HEAD differs from the pin —
# the pin records what CI builds against; the symlink is what you run locally.
# CI (--ci): fetch each repo at exactly the pinned sha into libs/<name>.
set -euo pipefail
cd "$(dirname "$0")/.."
LIBS_DIR="${LIBS_DIR:-$HOME/Projects}"
MODE=dev
[ "${1:-}" = "--ci" ] && MODE=ci
mkdir -p libs
while IFS=$'\t' read -r name repo sha; do
  case "$name" in ''|\#*) continue ;; esac
  if [ "$MODE" = ci ]; then
    rm -rf "libs/$name"
    git init -q "libs/$name"
    git -C "libs/$name" fetch -q --depth 1 "$repo" "$sha"
    git -C "libs/$name" checkout -q FETCH_HEAD
  else
    src="$LIBS_DIR/$name"
    [ -d "$src" ] || { echo "setup-libs: missing sibling checkout: $src" >&2; exit 1; }
    # A real directory here (left by a --ci run) would make ln -sfn nest the
    # link inside it instead of replacing it.
    [ -d "libs/$name" ] && [ ! -L "libs/$name" ] && rm -rf "libs/$name"
    ln -sfn "$src" "libs/$name"
    head="$(git -C "$src" rev-parse HEAD)"
    [ "$head" = "$sha" ] || {
      echo "setup-libs: drift: $name sibling at ${head:0:7}, pin is ${sha:0:7}" >&2
      echo "  (if install or typecheck fails, this drift is the first suspect:" >&2
      echo "   sync the sibling toward the pin, or bump the pin in libs.lock)" >&2
    }
  fi
done < libs.lock
