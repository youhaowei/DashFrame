#!/usr/bin/env bash
# Materialize the pinned libraries listed in libs.lock under libs/.
#
# Default: each libs/<name> is a real shallow clone checked out at the pinned
# sha. Idempotent — after a pin bump, re-running fetches and checks out the
# new sha. This is the same behavior locally and in CI (--ci is an alias),
# and it keeps turbo working: turbo refuses workspace packages whose real
# path is outside the repo root, so symlinks cannot be the default
# (https://github.com/vercel/turborepo/issues/2517).
#
# Co-development: `--link <name> [path]` replaces libs/<name> with a symlink
# to a sibling checkout or feature worktree so its edits are visible here
# live. While linked, turbo commands fail at workspace discovery; bun
# install / bun dev / vite still work. `--unlink <name>` restores the
# pinned clone. After any mode switch: rm -rf node_modules && bun install.
set -euo pipefail
cd "$(dirname "$0")/.."
LIBS_DIR="${LIBS_DIR:-$HOME/Projects}"

usage() {
  echo "usage: setup-libs.sh [--ci] | --link <name> [path] | --unlink <name>" >&2
  exit 2
}

MODE=pin
LINK_NAME=""
LINK_PATH=""
case "${1:-}" in
  '' | --ci) MODE=pin ;;
  --link)
    MODE=link
    LINK_NAME="${2:-}"
    [ -n "$LINK_NAME" ] || usage
    LINK_PATH="${3:-$LIBS_DIR/$LINK_NAME}"
    ;;
  --unlink)
    MODE=unlink
    LINK_NAME="${2:-}"
    [ -n "$LINK_NAME" ] || usage
    ;;
  *) usage ;;
esac

# refuse_to_clobber <dir>: exit if <dir> is a checkout we must not delete —
# a leftover submodule working directory, or a clone with local changes.
refuse_to_clobber() {
  dir="$1"
  [ -d "$dir" ] && [ ! -L "$dir" ] || return 0
  if [ -e "$dir/.git" ]; then
    if [ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]; then
      echo "setup-libs: $dir has local changes; commit them in the library's own repo or move the directory aside" >&2
      exit 1
    fi
  fi
}

found_entry=false
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

  if [ "$MODE" = link ] || [ "$MODE" = unlink ]; then
    [ "$name" = "$LINK_NAME" ] || continue
    found_entry=true
  fi

  mkdir -p libs
  case "$MODE" in
    link)
      [ -d "$LINK_PATH" ] || { echo "setup-libs: link target missing: $LINK_PATH" >&2; exit 1; }
      refuse_to_clobber "libs/$name"
      rm -rf "libs/$name"
      ln -sfn "$LINK_PATH" "libs/$name"
      head="$(git -C "$LINK_PATH" rev-parse --short HEAD 2>/dev/null || echo '?')"
      echo "setup-libs: libs/$name -> $LINK_PATH (at $head; pin is ${sha:0:7})" >&2
      echo "  co-dev mode: turbo commands will fail until '--unlink $name';" >&2
      echo "  bun install / bun dev still work. Refresh: rm -rf node_modules && bun install" >&2
      ;;
    unlink | pin)
      if [ -L "libs/$name" ]; then
        if [ "$MODE" = pin ]; then
          # A worktree deliberately in co-dev mode keeps its symlink across
          # re-runs; only --unlink leaves that mode.
          echo "setup-libs: libs/$name is linked to $(readlink "libs/$name") (co-dev mode); leaving it" >&2
          continue
        fi
        # Remove the link itself so every git command below acts on a real
        # clone under libs/ — never on the link's target.
        rm "libs/$name"
      fi
      if [ -e "libs/$name/.git" ] && [ -d "libs/$name/.git" ] && git -C "libs/$name" rev-parse HEAD >/dev/null 2>&1; then
        # Existing managed clone: incremental update to the pin.
        if [ "$(git -C "libs/$name" rev-parse HEAD)" != "$sha" ]; then
          refuse_to_clobber "libs/$name"
          git -C "libs/$name" fetch -q --depth 1 "$repo" "$sha" || {
            echo "setup-libs: cannot fetch $name@${sha:0:7} from $repo" >&2
            echo "  (is the pinned commit pushed? library changes must land in the" >&2
            echo "   library's remote before a consumer pin can reference them)" >&2
            exit 1
          }
          git -C "libs/$name" checkout -q --detach "$sha"
        fi
      else
        # Fresh clone at the pin. A leftover submodule working directory
        # shows up here as a gitfile (.git as a file, unreadable once the
        # superproject dropped the module) — never delete it automatically.
        if [ -e "libs/$name/.git" ] && [ ! -d "libs/$name/.git" ]; then
          echo "setup-libs: libs/$name looks like an old submodule checkout; move it aside first" >&2
          exit 1
        fi
        rm -rf "libs/$name"
        git init -q "libs/$name"
        git -C "libs/$name" fetch -q --depth 1 "$repo" "$sha" || {
          echo "setup-libs: cannot fetch $name@${sha:0:7} from $repo" >&2
          echo "  (is the pinned commit pushed? library changes must land in the" >&2
          echo "   library's remote before a consumer pin can reference them)" >&2
          exit 1
        }
        git -C "libs/$name" checkout -q --detach FETCH_HEAD
      fi
      ;;
  esac
done < libs.lock

if { [ "$MODE" = link ] || [ "$MODE" = unlink ]; } && [ "$found_entry" = false ]; then
  echo "setup-libs: no libs.lock entry named '$LINK_NAME'" >&2
  exit 2
fi
