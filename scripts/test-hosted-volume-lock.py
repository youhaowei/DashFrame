#!/usr/bin/env python3
"""Linux runtime proof: two processes, crash release, stable lock inode, and path rejection."""
import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile

if sys.platform != "linux":
    raise SystemExit("Run this verification on Linux with util-linux flock installed")

wrapper = Path(__file__).resolve().with_name("with-hosted-volume-lock.sh")


def command(volume, *args):
    return ["env", f"RAILWAY_VOLUME_MOUNT_PATH={volume}", "sh", str(wrapper), *args]


def run(volume, *args):
    return subprocess.run(command(volume, *args), capture_output=True, timeout=5, check=False)


with tempfile.TemporaryDirectory(prefix="dashframe-lock-proof-") as temporary:
    volume = Path(temporary)
    owner = subprocess.Popen(
        command(volume, "sh", "-c", "echo ready; exec sleep 60"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        with selectors.DefaultSelector() as ready:
            ready.register(owner.stdout, selectors.EVENT_READ)
            assert ready.select(timeout=5), "Owner did not reach locked command"
            assert owner.stdout.readline() == b"ready\n", "Owner failed to acquire lock"
        lock = volume / ".dashframe-runtime.lock"
        inode = lock.stat().st_ino
        assert lock.stat().st_mode & 0o777 == 0o600, "Lock file is not private"
        contender = run(volume, "sh", "-c", "echo must-not-run")
        assert contender.returncode == 73 and not contender.stdout, "Concurrent writer admitted"
        other = volume / "independent"
        other.mkdir()
        assert run(other, "true").returncode == 0, "Independent volume was blocked"
        owner.kill()
        owner.wait(timeout=5)
        assert run(volume, "true").returncode == 0, "Crash left a stale lock"
        assert lock.stat().st_ino == inode, "Restart replaced the shared lock inode"
        assert run("relative/path", "true").returncode == 78, "Relative volume accepted"
        assert run("/", "true").returncode == 78, "Filesystem root accepted as volume"
        unsafe = volume / "unsafe"
        unsafe.mkdir()
        (unsafe / ".dashframe-runtime.lock").symlink_to(lock)
        assert run(unsafe, "true").returncode == 78, "Symlink lock accepted"
    finally:
        if owner.poll() is None:
            owner.kill()
            owner.wait(timeout=5)
        owner.stdout.close()
        owner.stderr.close()
print("PASS: contention, independent volumes, crash recovery, stable inode, private mode, unsafe paths")
