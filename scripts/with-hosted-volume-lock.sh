#!/bin/sh
set -eu

# Own the whole persistent volume for the lifetime of the hosted process.
# Never unlink this lock file: replacing its inode would admit a second writer.
# flock releases on process exit, including crashes; no PID reclamation is used.
: "${RAILWAY_VOLUME_MOUNT_PATH:?Attach a Railway volume before starting DashFrame}"
[ "$#" -gt 0 ] || { echo "A hosted command is required" >&2; exit 78; }
[ "$(uname -s)" = Linux ] || { echo "Hosted volume locking requires Linux" >&2; exit 78; }
command -v flock >/dev/null 2>&1 || { echo "Hosted volume locking requires util-linux flock" >&2; exit 78; }
case "$RAILWAY_VOLUME_MOUNT_PATH" in
  /*) ;;
  *) echo "Hosted volume path must be absolute" >&2; exit 78 ;;
esac
volume_root=$(cd -P "$RAILWAY_VOLUME_MOUNT_PATH" && pwd -P)
[ "$volume_root" != / ] || { echo "Hosted volume cannot be the filesystem root" >&2; exit 78; }
lock_path="$volume_root/.dashframe-runtime.lock"
[ ! -L "$lock_path" ] || { echo "Hosted volume lock cannot be a symlink" >&2; exit 78; }
umask 077
# --no-fork keeps the lock in the command process. Contention exits 73 before
# any workspace, vault, or query worker is opened. The backing filesystem must
# support flock across every process that can mount this volume.
exec flock --exclusive --nonblock --no-fork --conflict-exit-code 73 "$lock_path" "$@"
