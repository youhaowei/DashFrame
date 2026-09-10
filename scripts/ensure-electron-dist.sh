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

_cleanup_target=""
_cleanup_replacement=""
_cleanup_stage=""
_cleanup_stage_path=""
_private_backup=""
_private_backup_action=""

restore_or_discard_private_backup() {
  [ -n "$_private_backup" ] || return 0
  _restore_failed=false
  if [ "$_private_backup_action" = restore ]; then
    if [ -e "$_private_backup/dist" ] || [ -L "$_private_backup/dist" ]; then
      rm -rf "$pkg/dist" 2>/dev/null || true
      if ! mv "$_private_backup/dist" "$pkg/dist" 2>/dev/null; then
        _restore_failed=true
      fi
    fi
    if [ -e "$_private_backup/path.txt" ] || [ -L "$_private_backup/path.txt" ]; then
      rm -f "$pkg/path.txt" 2>/dev/null || true
      if ! mv "$_private_backup/path.txt" "$pkg/path.txt" 2>/dev/null; then
        _restore_failed=true
      fi
    fi
  fi
  if [ "$_restore_failed" = true ]; then
    echo "[electron-dist] could not restore the previous private dist from $_private_backup." >&2
    return 1
  fi
  rm -rf "$_private_backup" 2>/dev/null || return 1
  _private_backup=""
  _private_backup_action=""
}

cleanup() {
  restore_or_discard_private_backup || true
  [ -z "$_cleanup_target" ] || rm -rf "$_cleanup_target" 2>/dev/null || true
  [ -z "$_cleanup_replacement" ] || rm -rf "$_cleanup_replacement" 2>/dev/null || true
  [ -z "$_cleanup_stage" ] || rm -rf "$_cleanup_stage" 2>/dev/null || true
  [ -z "$_cleanup_stage_path" ] || rm -f "$_cleanup_stage_path" 2>/dev/null || true
}

trap cleanup 0
trap 'trap - HUP INT TERM; exit 1' HUP INT TERM

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

# usable <dir> <path-file> [<version> <platform> <architecture>]
# With only a directory and path file, check the same minimum contract as
# Electron's index.js. Once a cache identity is known, also require the
# installer's version marker, platform-specific path, and binary architecture.
# This keeps a stale Rosetta/private install out of another architecture's
# cache even when its executable bit and path happen to look valid.
usable() {
  _u_dir="$1"
  _u_file="$2"
  [ -f "$_u_file" ] || return 1
  _u_rel=$(cat "$_u_file" 2>/dev/null) || return 1
  [ -n "$_u_rel" ] || return 1
  [ -x "$_u_dir/$_u_rel" ] || return 1
  [ "$#" -ge 5 ] || return 0

  _u_version=$(cat "$_u_dir/version" 2>/dev/null) || return 1
  _u_version=${_u_version#v}
  [ "$_u_version" = "$3" ] || return 1
  case "$4" in
    darwin|mas) _u_expected="Electron.app/Contents/MacOS/Electron" ;;
    freebsd|openbsd|linux) _u_expected="electron" ;;
    win32) _u_expected="electron.exe" ;;
    *) return 1 ;;
  esac
  [ "$_u_rel" = "$_u_expected" ] || return 1

  # Read executable headers with the runtime already required by install.js.
  # Minimal Linux installations need no additional file(1) package.
  node -e '
    const fs = require("fs");
    try {
      const b = fs.readFileSync(process.argv[1]);
      const platform = process.argv[2];
      const arch = process.argv[3];
      let matches = false;
      if (platform === "darwin" || platform === "mas") {
        const cpu = {x64: 0x01000007, arm64: 0x0100000c, ia32: 7}[arch];
        const magic = b.readUInt32BE(0);
        if (magic === 0xcffaedfe || magic === 0xcefaedfe) {
          matches = cpu !== undefined && b.readUInt32LE(4) === cpu;
        } else if (magic === 0xcafebabe || magic === 0xcafebabf) {
          const count = b.readUInt32BE(4);
          const stride = magic === 0xcafebabf ? 32 : 20;
          const cpus = [];
          for (let i = 0; i < count; i++) cpus.push(b.readUInt32BE(8 + i * stride));
          matches = arch === "universal"
            ? cpus.includes(0x01000007) && cpus.includes(0x0100000c)
            : cpu !== undefined && cpus.includes(cpu);
        }
      } else if (platform === "win32" && b.toString("ascii", 0, 2) === "MZ") {
        const offset = b.readUInt32LE(60);
        const machine = {x64: 0x8664, arm64: 0xaa64, ia32: 0x14c}[arch];
        matches = machine !== undefined && b.readUInt32LE(offset) === 0x4550
          && b.readUInt16LE(offset + 4) === machine;
      } else if (["linux", "freebsd", "openbsd"].includes(platform)
          && b.readUInt32BE(0) === 0x7f454c46) {
        const machine = {x64: 62, arm64: 183, ia32: 3, arm: 40, armv7l: 40, mips64el: 8}[arch];
        matches = machine !== undefined && b[5] === 1 && b.readUInt16LE(18) === machine;
      }
      process.exit(matches ? 0 : 1);
    } catch { process.exit(1); }
  ' "$_u_dir/$_u_rel" "$4" "$5"
}

# give_up <message>
# End the run. Exit status reports whether Electron is usable, not whether the
# sharing optimisation worked: a worktree with its own private copy is a
# success, a worktree with no binaries is a failure the caller must see.
give_up() {
  echo "[electron-dist] $1" >&2
  if [ -n "${version:-}" ] \
    && [ -n "${target_platform:-}" ] \
    && [ -n "${target_arch:-}" ]; then
    if usable "$pkg/dist" "$pkg/path.txt" "$version" "$target_platform" "$target_arch"; then
      exit 0
    fi
  elif usable "$pkg/dist" "$pkg/path.txt"; then
    exit 0
  fi
  echo "[electron-dist] Electron is not installed in $pkg." >&2
  exit 1
}

# Validate the requested target even when a private distribution exists.
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
target_arch=$(node -e '
  const childProcess = require("child_process");
  let arch = process.env.npm_config_arch || process.arch;
  const platform = process.env.npm_config_platform || process.platform;
  if (platform === "darwin" && process.platform === "darwin" && arch === "x64"
      && process.env.npm_config_arch === undefined) {
    try {
      if (childProcess.execSync("sysctl -in sysctl.proc_translated").toString().trim() === "1") {
        arch = "arm64";
      }
    } catch {}
  }
  process.stdout.write(arch);
') \
  || give_up "cannot determine Electron's target architecture."
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

if [ "$force" = false ] \
  && usable "$pkg/dist" "$pkg/path.txt" "$version" "$target_platform" "$target_arch"; then
  exit 0
fi

cache="${DASHFRAME_ELECTRON_CACHE:-$HOME/.cache/dashframe/electron}/$version/$target_platform-$target_arch"
shared="$cache/dist"
shared_pathfile="$cache/path.txt"

install_private() {
  echo "[electron-dist] running Electron's private installer..." >&2
  if ! stage_target_install; then
    give_up "Electron's installer failed."
  fi
  replace_private "$_cleanup_target/dist" "$_cleanup_target/path.txt" copy \
    || give_up "Electron's installer produced a dist that could not replace the private copy."
}

# use_private <reason>
# A cache problem loses only the sharing optimisation. Preserve an existing
# usable private dist, or install one if this worktree has no usable binaries.
use_private() {
  echo "[electron-dist] $1; using a private Electron dist." >&2
  if usable "$pkg/dist" "$pkg/path.txt" "$version" "$target_platform" "$target_arch"; then
    return 0
  fi
  install_private
}

# Install into a target-specific staging package. Electron's own installer
# verifies the downloaded archive checksum; usable then verifies the extracted
# version, platform path, architecture, and executable before publication.
# The live private dist is untouched if download, extraction, or validation
# fails.
stage_target_install() {
  if [ -n "$_cleanup_target" ] \
    && usable "$_cleanup_target/dist" "$_cleanup_target/path.txt" \
      "$version" "$target_platform" "$target_arch"; then
    return 0
  fi
  [ -z "$_cleanup_target" ] || rm -rf "$_cleanup_target"
  _cleanup_target=$(mktemp -d "$pkg/.target-install.XXXXXX") || return 1
  if ! cp "$pkg/install.js" "$pkg/package.json" "$pkg/checksums.json" "$_cleanup_target/" \
    || ! (unset ELECTRON_SKIP_BINARY_DOWNLOAD; cd "$_cleanup_target"; node install.js >&2) \
    || ! usable "$_cleanup_target/dist" "$_cleanup_target/path.txt" \
      "$version" "$target_platform" "$target_arch"; then
    return 1
  fi
}

# replace_private <source-dist> <source-path-file> <clone|copy>
# Build and validate the replacement first. The short final swap is guarded by
# an EXIT/signal cleanup: before validation it restores the previous private
# install; after validation it only discards the backup. Thus --force never
# strands a worktree or leaves backup/staging directories behind.
replace_private() {
  _rp_source="$1"
  _rp_path="$2"
  _rp_mode="$3"
  [ -z "$_private_backup" ] || return 1
  _cleanup_replacement=$(mktemp -d "$pkg/.dist-replacement.XXXXXX") || return 1
  if [ "$_rp_mode" = clone ]; then
    cp -c -R "$_rp_source" "$_cleanup_replacement/dist" 2>/dev/null || return 1
  else
    cp -R "$_rp_source" "$_cleanup_replacement/dist" 2>/dev/null || return 1
  fi
  cp "$_rp_path" "$_cleanup_replacement/path.txt" 2>/dev/null || return 1
  usable "$_cleanup_replacement/dist" "$_cleanup_replacement/path.txt" \
    "$version" "$target_platform" "$target_arch" || return 1

  _private_backup=$(mktemp -d "$pkg/.dist-backup.XXXXXX") || return 1
  _private_backup_action=restore
  if [ -e "$pkg/dist" ] || [ -L "$pkg/dist" ]; then
    mv "$pkg/dist" "$_private_backup/dist" || return 1
  fi
  if [ -e "$pkg/path.txt" ] || [ -L "$pkg/path.txt" ]; then
    mv "$pkg/path.txt" "$_private_backup/path.txt" || return 1
  fi
  if ! mv "$_cleanup_replacement/dist" "$pkg/dist" \
    || ! mv "$_cleanup_replacement/path.txt" "$pkg/path.txt" \
    || ! usable "$pkg/dist" "$pkg/path.txt" \
      "$version" "$target_platform" "$target_arch"; then
    restore_or_discard_private_backup
    return 1
  fi

  _private_backup_action=discard
  restore_or_discard_private_backup
  rm -rf "$_cleanup_replacement"
  _cleanup_replacement=""
  return 0
}

clone_shared() {
  replace_private "$shared" "$shared_pathfile" clone
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
    _lock_rc=0
    if [ "$force" = true ]; then
      DASHFRAME_ELECTRON_DIST_LOCKED=1 lockf -t 900 "$cache/.lock" "$0" --force "$wt" \
        || _lock_rc=$?
    else
      DASHFRAME_ELECTRON_DIST_LOCKED=1 lockf -t 900 "$cache/.lock" "$0" "$wt" \
        || _lock_rc=$?
    fi
    case "$_lock_rc" in
      0) exit 0 ;;
      1|2) exit "$_lock_rc" ;;
      *)
        use_private "shared cache lock could not be acquired"
        exit 0
        ;;
    esac
  fi
  if command -v flock >/dev/null 2>&1; then
    _lock_rc=0
    if [ "$force" = true ]; then
      DASHFRAME_ELECTRON_DIST_LOCKED=1 flock -E 75 -w 900 "$cache/.lock" "$0" --force "$wt" \
        || _lock_rc=$?
    else
      DASHFRAME_ELECTRON_DIST_LOCKED=1 flock -E 75 -w 900 "$cache/.lock" "$0" "$wt" \
        || _lock_rc=$?
    fi
    case "$_lock_rc" in
      0) exit 0 ;;
      75)
        use_private "shared cache lock could not be acquired"
        exit 0
        ;;
      *) exit "$_lock_rc" ;;
    esac
  fi
  use_private "no shared cache locking tool is available"
  exit 0
fi

# Seed through Electron's installer only when no architecture-specific shared
# copy exists. Publishing uses a staging directory under the lock so a reader
# can never observe a half-populated cache.
if ! usable "$shared" "$shared_pathfile" "$version" "$target_platform" "$target_arch"; then
  echo "[electron-dist] installing target $version ($target_platform-$target_arch) for cache seeding." >&2
  if ! stage_target_install; then
    echo "[electron-dist] target install failed; preserved the previous private install without seeding." >&2
    exit 1
  fi

  _stage="$shared.tmp.$$"
  _stage_path="$shared_pathfile.tmp.$$"
  _cleanup_stage="$_stage"
  _cleanup_stage_path="$_stage_path"
  if ! rm -rf "$_stage" 2>/dev/null || ! rm -f "$_stage_path" 2>/dev/null; then
    use_private "stale shared cache staging could not be removed"
    exit 0
  fi
  if ! cp -c -R "$_cleanup_target/dist" "$_stage" 2>/dev/null \
    || ! cp "$_cleanup_target/path.txt" "$_stage_path" 2>/dev/null; then
    rm -rf "$_stage"
    rm -f "$_stage_path"
    _cleanup_stage=""
    _cleanup_stage_path=""
    use_private "shared cache could not be seeded"
    exit 0
  fi
  if ! rm -rf "$shared" 2>/dev/null || ! rm -f "$shared_pathfile" 2>/dev/null; then
    use_private "stale shared cache entry could not be removed"
    exit 0
  fi
  if ! mv "$_stage" "$shared" \
    || ! mv "$_stage_path" "$shared_pathfile" \
    || ! usable "$shared" "$shared_pathfile"; then
    rm -rf "$_stage"
    rm -f "$_stage_path"
    use_private "shared cache could not be published"
    exit 0
  fi
  _cleanup_stage=""
  _cleanup_stage_path=""
  echo "[electron-dist] seeded shared copy at $shared" >&2
fi

echo "[electron-dist] cloning Electron $version ($target_platform-$target_arch) from $shared..." >&2
if ! clone_shared; then
  use_private "shared dist could not be cloned"
fi
