#!/usr/bin/env sh
# ensure-electron-dist.sh — give a worktree Electron's binaries for ~0 disk
#
# USAGE:
#   scripts/ensure-electron-dist.sh [worktree-path]   # default: repo root
#
# Electron's npm package is a ~1 MiB stub whose `postinstall` downloads a
# ~95 MiB zip and unzips it to ~242 MiB inside node_modules. The download is
# cached (Electron caches the zip itself, bun caches the stub); the EXTRACTION
# is not, so every worktree pays the full 242 MiB and the full unzip. On a
# machine with a dozen worktrees that is most of what node_modules costs.
#
# This keeps ONE extracted copy per version under
#   ~/.cache/dashframe/electron/<version>/dist
# and gives each worktree an APFS clone of it. `cp -c` is copy-on-write, so the
# clone shares blocks with the shared copy and costs essentially nothing.
#
# WHY A CLONE RATHER THAN ELECTRON_OVERRIDE_DIST_PATH:
# Electron honours that variable, and it would cost literally zero — but only
# in processes that have it set. Every launcher, test runner, e2e harness and
# packaging step would have to set it, and forgetting it fails at runtime with
# a confusing "Electron failed to install correctly". A cloned dist puts the
# real layout where Electron already looks, so nothing downstream changes and
# nothing has to remember anything.
#
# FAIL-OPEN, BUT NOT FAIL-SILENT. Every sharing failure falls back to
# Electron's own installer, so a worktree may end up with its own full copy —
# that is fine, it is only the optimisation that was lost. What is NOT fine is
# ending with no Electron at all: the caller sets ELECTRON_SKIP_BINARY_DOWNLOAD
# for the install, so this script is the only thing that puts the binaries in
# place. It therefore exits non-zero whenever it leaves the package unusable,
# and the caller must not record the worktree as provisioned in that case.
set -eu

wt="${1:-$(git rev-parse --show-toplevel)}"

# Find the real Electron package directory. Bun's isolated linker puts it in
# the content-addressed store and leaves only symlinks in the workspace, so
# node_modules/electron is not where it lives here; a hoisted linker does put
# it there. Resolve through the desktop app, which is the package that actually
# depends on Electron, and fall back to the store and then the hoisted path.
# `-P` on cd resolves the symlink, so `pkg` is always the real directory that
# the dist must be written into.
pkg=""
for _cand in \
  "$wt/apps/desktop/node_modules/electron" \
  "$wt/node_modules/electron"
do
  if [ -d "$_cand" ]; then pkg=$(cd -P "$_cand" && pwd); break; fi
done
if [ -z "$pkg" ]; then
  # Bun isolated store: node_modules/.bun/electron@<version>/node_modules/electron
  for _cand in "$wt"/node_modules/.bun/electron@*/node_modules/electron; do
    if [ -d "$_cand" ]; then pkg=$(cd -P "$_cand" && pwd); break; fi
  done
fi

# No Electron in this worktree (server-only checkout, or install skipped) —
# nothing to do, and nothing broken.
[ -n "$pkg" ] && [ -d "$pkg" ] || exit 0

# usable <dir> <path-file>
# True when <path-file> names an executable inside <dir>. This is exactly what
# Electron's own index.js does to find the binary, so it is the only honest
# test of "is this dist actually usable". An empty or missing path file counts
# as unusable — `-x` on a bare directory would otherwise pass.
usable() {
  _u_dir="$1"
  _u_file="$2"
  [ -f "$_u_file" ] || return 1
  _u_rel=$(cat "$_u_file" 2>/dev/null) || return 1
  [ -n "$_u_rel" ] || return 1
  [ -x "$_u_dir/$_u_rel" ]
}

# give_up <message>
# End the run. Exit status reports whether Electron is usable, not whether the
# sharing optimisation worked: a worktree with its own private copy is a
# success, a worktree with no binaries is a failure the caller must see.
give_up() {
  echo "[electron-dist] $1" >&2
  if usable "$pkg/dist" "$pkg/path.txt"; then
    exit 0
  fi
  echo "[electron-dist] Electron is not installed in $pkg." >&2
  exit 1
}

version=$(node -p "require(process.argv[1] + '/package.json').version" "$pkg" 2>/dev/null || echo "")
if [ -z "$version" ]; then
  give_up "cannot read Electron's version from $pkg."
fi

cache="${DASHFRAME_ELECTRON_CACHE:-$HOME/.cache/dashframe/electron}/$version"
shared="$cache/dist"

# `path.txt` is what Electron's own index.js reads to find the executable
# inside dist. A dist without it is unusable, so it is cached alongside.
shared_pathfile="$cache/path.txt"

# ── Already provisioned? ─────────────────────────────────────────────────────
# Tested before taking the lock: the overwhelmingly common case is a worktree
# that is already done, and it should cost one stat.
if usable "$pkg/dist" "$pkg/path.txt"; then
  exit 0
fi

# ── Serialise everything below, per Electron version ─────────────────────────
# Two worktrees provisioning the same uncached version otherwise race: one can
# delete the shared copy from under the other's `cp`, or publish over a copy
# another process is still reading. The lock is a kernel flock on the lock
# file, so it is released by the kernel if this process dies — no stale lock
# survives a crash. Re-exec under it rather than wrapping a block, so the
# checks above run again on the far side; the loser of a seeding race then
# correctly takes the cheap clone path instead of seeding a second time.
if [ -z "${DASHFRAME_ELECTRON_DIST_LOCKED:-}" ]; then
  _lockcmd=""
  if command -v lockf >/dev/null 2>&1; then
    _lockcmd="lockf -t 900"          # macOS
  elif command -v flock >/dev/null 2>&1; then
    _lockcmd="flock -w 900"          # util-linux
  fi
  if [ -n "$_lockcmd" ]; then
    mkdir -p "$cache"
    export DASHFRAME_ELECTRON_DIST_LOCKED=1
    # shellcheck disable=SC2086  # _lockcmd is a fixed command plus its flag
    exec $_lockcmd "$cache/.lock" "$0" "$wt"
  fi
  # No locking tool at all (neither macOS's lockf nor util-linux's flock).
  # Carry on, but seeding is disabled below: publishing the shared copy is the
  # only step that can damage a concurrent reader, and unserialised it can
  # replace a dist another worktree is mid-copy. Reading an existing shared
  # copy stays safe, because nothing can be writing one.
  DASHFRAME_ELECTRON_DIST_NOLOCK=1
fi

# ── Seed the shared copy, if this is the first worktree to need it ───────────
if ! usable "$shared" "$shared_pathfile"; then
  # Let Electron's own installer do the download+extract, exactly once. It
  # writes into this worktree; we then promote the result to the shared cache.
  if ! usable "$pkg/dist" "$pkg/path.txt"; then
    echo "[electron-dist] no shared copy for $version yet; installing once..." >&2
    (cd "$pkg" && node install.js >&2) \
      || give_up "Electron's installer failed."
    usable "$pkg/dist" "$pkg/path.txt" \
      || give_up "Electron's installer reported success but produced no usable dist."
  fi
  if [ -n "${DASHFRAME_ELECTRON_DIST_NOLOCK:-}" ]; then
    echo "[electron-dist] no locking tool available; not seeding the shared copy." >&2
    exit 0
  fi
  mkdir -p "$cache"
  _stage="$shared.tmp.$$"
  rm -rf "$_stage"
  # Copy into a private staging name and rename, so a concurrent reader never
  # sees a half-populated shared copy. rename(2) is atomic within a filesystem.
  if cp -c -R "$pkg/dist" "$_stage" 2>/dev/null || cp -R "$pkg/dist" "$_stage" 2>/dev/null; then
    rm -rf "$shared"
    mv "$_stage" "$shared"
    cp "$pkg/path.txt" "$shared_pathfile"
    echo "[electron-dist] seeded shared copy at $shared" >&2
  else
    rm -rf "$_stage"
    echo "[electron-dist] could not seed the shared copy; this worktree keeps its own." >&2
  fi
  exit 0
fi

# ── Clone the shared copy into this worktree ─────────────────────────────────
echo "[electron-dist] cloning Electron $version from $shared..." >&2
rm -rf "$pkg/dist.tmp"
if cp -c -R "$shared" "$pkg/dist.tmp" 2>/dev/null; then
  rm -rf "$pkg/dist"
  mv "$pkg/dist.tmp" "$pkg/dist"
  cp "$shared_pathfile" "$pkg/path.txt"
  usable "$pkg/dist" "$pkg/path.txt" \
    || give_up "the cloned dist is not usable."
else
  # Cross-volume, non-APFS, or anything else: fall back to the ordinary
  # install rather than leaving the worktree without Electron.
  rm -rf "$pkg/dist.tmp"
  echo "[electron-dist] clone failed; running Electron's installer instead." >&2
  (cd "$pkg" && node install.js >&2) \
    || give_up "Electron's installer failed."
  usable "$pkg/dist" "$pkg/path.txt" \
    || give_up "Electron's installer produced no usable dist."
fi
