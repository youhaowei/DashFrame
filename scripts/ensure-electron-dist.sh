#!/usr/bin/env sh
# ensure-electron-dist.sh — give a worktree Electron's binaries for ~0 disk
#
# USAGE:
#   scripts/ensure-electron-dist.sh [--force] [worktree-path]
#
# The worktree path defaults to the repository root. --force replaces an
# existing private dist with a clone from the shared cache when sharing is
# available; use it after a manual install has downloaded a private copy.
#
# Electron's npm package is a ~1 MiB stub whose `postinstall` downloads a
# ~95 MiB zip and unzips it to ~242 MiB inside node_modules. The download is
# cached (Electron caches the zip itself, bun caches the stub); the EXTRACTION
# is not, so every worktree pays the full 242 MiB and the full unzip. On a
# machine with a dozen worktrees that is most of what node_modules costs.
#
# This keeps ONE extracted copy per version, platform, and architecture under
#   ~/.cache/dashframe/electron/<version>/<platform>-<architecture>/dist
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
# ending with no Electron at all: the caller may skip the binary download for
# the package install, so this script exits non-zero whenever it leaves the
# package unusable.
set -eu

usage() {
  echo "Usage: scripts/ensure-electron-dist.sh [--force] [worktree-path]" >&2
}

force=false
case "${1:-}" in
  --force)
    force=true
    shift
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  --*)
    usage
    exit 2
    ;;
esac
if [ "$#" -gt 1 ]; then
  usage
  exit 2
fi

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

# The common path needs no runtime at all. A forced conversion or missing dist
# does need Node because Electron's package metadata and installer are Node
# scripts; fail before claiming that provisioning succeeded when it is absent.
if [ "$force" = false ] && usable "$pkg/dist" "$pkg/path.txt"; then
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[electron-dist] Node.js is required to provision Electron." >&2
  exit 1
fi

version=$(node -p "require(process.argv[1] + '/package.json').version" "$pkg" 2>/dev/null) \
  || give_up "cannot read Electron's version from $pkg."
if [ -z "$version" ]; then
  give_up "cannot read Electron's version from $pkg."
fi

# Match Electron's install.js target selection, including its Rosetta special
# case. A version-only key can otherwise hand a darwin-arm64 binary to an x64
# worktree (or vice versa), and the executable-bit usability check cannot tell.
target_platform=$(node -p "process.env.npm_config_platform || process.platform") \
  || give_up "cannot determine Electron's target platform."
target_arch=$(node -p "process.env.npm_config_arch || process.arch") \
  || give_up "cannot determine Electron's target architecture."
if [ "$target_platform" = darwin ] \
  && [ "$(node -p 'process.platform')" = darwin ] \
  && [ "$target_arch" = x64 ] \
  && [ "${npm_config_arch+x}" != x ] \
  && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
  target_arch=arm64
fi
case "$version" in
  ""|.|..|*[!A-Za-z0-9._-]*)
    give_up "Electron's cache identity contains unsupported characters."
    ;;
esac
case "$target_platform" in
  ""|.|..|*[!A-Za-z0-9._-]*)
    give_up "Electron's target platform is not cache-safe."
    ;;
esac
case "$target_arch" in
  ""|.|..|*[!A-Za-z0-9._-]*)
    give_up "Electron's target architecture is not cache-safe."
    ;;
esac

cache="${DASHFRAME_ELECTRON_CACHE:-$HOME/.cache/dashframe/electron}/$version/$target_platform-$target_arch"
shared="$cache/dist"
shared_pathfile="$cache/path.txt"

install_private() {
  echo "[electron-dist] running Electron's private installer..." >&2
  if ! (
    unset ELECTRON_SKIP_BINARY_DOWNLOAD
    cd "$pkg"
    node install.js >&2
  ); then
    give_up "Electron's installer failed."
  fi
  usable "$pkg/dist" "$pkg/path.txt" \
    || give_up "Electron's installer reported success but produced no usable dist."
}

# use_private <reason>
# A cache problem loses only the sharing optimisation. Preserve an existing
# usable private dist, or install one if this worktree has no usable binaries.
use_private() {
  echo "[electron-dist] $1; using a private Electron dist." >&2
  if usable "$pkg/dist" "$pkg/path.txt"; then
    return 0
  fi
  install_private
}

# clone_shared
# Prepare and validate a clone before replacing the current dist. This makes
# --force safe: if cloning fails, the existing private copy remains usable.
clone_shared() {
  _cs_dist="$pkg/dist.tmp.$$"
  _cs_path="$pkg/path.txt.tmp.$$"
  rm -rf "$_cs_dist"
  rm -f "$_cs_path"
  if ! cp -c -R "$shared" "$_cs_dist" 2>/dev/null \
    || ! cp "$shared_pathfile" "$_cs_path" 2>/dev/null \
    || ! usable "$_cs_dist" "$_cs_path"; then
    rm -rf "$_cs_dist"
    rm -f "$_cs_path"
    return 1
  fi
  rm -rf "$pkg/dist"
  mv "$_cs_dist" "$pkg/dist"
  mv "$_cs_path" "$pkg/path.txt"
  usable "$pkg/dist" "$pkg/path.txt"
}

# The cache must be a writable directory on a clone-compatible filesystem and
# volume. The tiny real clone below proves all three properties before the
# script takes a lock or seeds hundreds of MiB. On Linux `cp -c` is absent; on
# non-APFS or cross-volume macOS layouts clonefile fails. Those are ordinary
# private-install paths, not provisioning failures.
if [ -e "$cache" ] && [ ! -d "$cache" ]; then
  use_private "shared cache path is not a directory"
  exit 0
fi
if ! mkdir -p "$cache" 2>/dev/null; then
  use_private "shared cache directory cannot be created"
  exit 0
fi
_probe="$cache/.clone-probe.$$"
if ! cp -c "$pkg/package.json" "$_probe" 2>/dev/null; then
  rm -f "$_probe" 2>/dev/null || true
  use_private "shared cache does not support clonefile from this worktree"
  exit 0
fi
if ! rm -f "$_probe" 2>/dev/null; then
  use_private "shared cache directory is not writable"
  exit 0
fi

# Serialise cache publication and reads. Re-enter under the kernel lock so the
# checks run again after a competing seeder finishes. If the lock tool is
# missing, the lock cannot be created, or acquisition times out, fall back to
# the private installer instead of failing under `set -e`.
if [ -z "${DASHFRAME_ELECTRON_DIST_LOCKED:-}" ]; then
  if command -v lockf >/dev/null 2>&1; then
    if [ "$force" = true ]; then
      DASHFRAME_ELECTRON_DIST_LOCKED=1 lockf -t 900 "$cache/.lock" "$0" --force "$wt" && exit 0
    else
      DASHFRAME_ELECTRON_DIST_LOCKED=1 lockf -t 900 "$cache/.lock" "$0" "$wt" && exit 0
    fi
    use_private "shared cache lock could not be acquired"
    exit 0
  fi
  if command -v flock >/dev/null 2>&1; then
    if [ "$force" = true ]; then
      DASHFRAME_ELECTRON_DIST_LOCKED=1 flock -w 900 "$cache/.lock" "$0" --force "$wt" && exit 0
    else
      DASHFRAME_ELECTRON_DIST_LOCKED=1 flock -w 900 "$cache/.lock" "$0" "$wt" && exit 0
    fi
    use_private "shared cache lock could not be acquired"
    exit 0
  fi
  use_private "no shared cache locking tool is available"
  exit 0
fi

# Seed through Electron's installer only when no architecture-specific shared
# copy exists. Publishing uses a staging directory under the lock so a reader
# can never observe a half-populated cache.
if ! usable "$shared" "$shared_pathfile"; then
  if ! usable "$pkg/dist" "$pkg/path.txt"; then
    echo "[electron-dist] no shared copy for $version ($target_platform-$target_arch) yet." >&2
    install_private
  fi

  _stage="$shared.tmp.$$"
  _stage_path="$shared_pathfile.tmp.$$"
  rm -rf "$_stage"
  rm -f "$_stage_path"
  if ! cp -c -R "$pkg/dist" "$_stage" 2>/dev/null \
    || ! cp "$pkg/path.txt" "$_stage_path" 2>/dev/null; then
    rm -rf "$_stage"
    rm -f "$_stage_path"
    use_private "shared cache could not be seeded"
    exit 0
  fi
  rm -rf "$shared"
  rm -f "$shared_pathfile"
  if ! mv "$_stage" "$shared" \
    || ! mv "$_stage_path" "$shared_pathfile" \
    || ! usable "$shared" "$shared_pathfile"; then
    rm -rf "$_stage"
    rm -f "$_stage_path"
    use_private "shared cache could not be published"
    exit 0
  fi
  echo "[electron-dist] seeded shared copy at $shared" >&2
fi

echo "[electron-dist] cloning Electron $version ($target_platform-$target_arch) from $shared..." >&2
if ! clone_shared; then
  use_private "shared dist could not be cloned"
fi
