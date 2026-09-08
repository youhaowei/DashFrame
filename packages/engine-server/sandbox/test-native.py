"""Compile and execute the launcher against a native adversarial workload.

Uses only disposable files. No installed or production service is involved.
Pass --cc if the C compiler is outside PATH; --read adds a runtime library root.
"""
import argparse
import ctypes
import json
import os
import pathlib
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument('--cc', default='cc')
parser.add_argument('--read', action='append', default=[])
args = parser.parse_args()
source = pathlib.Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='dashframe-native-boundary-') as temp:
    root = pathlib.Path(temp)
    launcher, probe = root / 'launcher', root / 'probe'
    for name, output in [('query-launcher.c', launcher), ('boundary-probe.c', probe)]:
        subprocess.run([*shlex.split(args.cc), '-O2', '-Wall', '-Wextra', '-Werror', '-pthread',
                        str(source / name), '-o', str(output)], check=True)
    sentinel = root / 'foreign-secret'
    sentinel.write_text('disposable random workspace marker')
    other_binary = root / 'readable-other-binary'
    shutil.copy2(probe, other_binary)
    base = [str(launcher), '--uid', str(os.getuid()), '--gid', str(os.getgid()),
            '--parent-pid', str(os.getpid()),
            '--memory-bytes', str(256 * 1024 * 1024), '--cpu-seconds', '5',
            '--threads', '4096']
    reads = [str(probe), str(other_binary), '/usr/lib', '/lib', '/lib64', *args.read]
    for path in reads:
        if pathlib.Path(path).exists():
            base += ['--read', path]
    environment = dict(os.environ, QUERY_SANDBOX_SENTINEL='disposable-environment-marker')
    with sentinel.open('rb') as descriptor:
        command = base + ['--', str(probe), str(sentinel), str(os.getpid()),
                          str(descriptor.fileno()), str(other_binary)]
        result = subprocess.run(command, input=b'', stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, env=environment, timeout=15,
                                pass_fds=(descriptor.fileno(),))
    print(result.stderr.decode(), end='')
    print(result.stdout.decode(), end='')
    if result.returncode:
        raise SystemExit(result.returncode)
    # Fail closed when a configured path is missing; do not silently skip it.
    rejected = subprocess.run(base + ['--read', str(root / 'absent'), '--', str(probe)],
                              input=b'', stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=15)
    assert rejected.returncode == 91, rejected
    print('PASS missing policy path fails closed')
    spinning = subprocess.run(base + ['--cpu-seconds', '1', '--', str(probe), '--spin'],
                              input=b'', stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=10)
    assert spinning.returncode == -signal.SIGKILL, spinning
    print('PASS hard CPU lifetime ceiling enforced')
    # Adopt the disposable grandchild so this test can prove termination and
    # reap it rather than mistake a lingering zombie for a running worker.
    libc = ctypes.CDLL(None, use_errno=True)
    was_subreaper = ctypes.c_int()
    assert libc.prctl(37, ctypes.byref(was_subreaper), 0, 0, 0) == 0
    assert libc.prctl(36, 1, 0, 0, 0) == 0
    supervisor = '''
import json, os, subprocess, sys
command = json.loads(sys.argv[1])
command += ['--parent-pid', str(os.getpid()), '--cpu-seconds', '30', '--', sys.argv[2], '--spin']
worker = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
assert worker.stdout.readline() == b'SPINNING\\n'
print(worker.pid, flush=True)
os._exit(0)
'''
    child = None
    try:
        stopped_parent = subprocess.run([sys.executable, '-c', supervisor, json.dumps(base), str(probe)],
                                        capture_output=True, check=True, timeout=10)
        child = int(stopped_parent.stdout.strip())
        deadline = time.monotonic() + 3
        reaped = 0
        while time.monotonic() < deadline:
            reaped, status = os.waitpid(child, os.WNOHANG)
            if reaped:
                break
            time.sleep(0.02)
        assert reaped == child and os.WIFSIGNALED(status) and os.WTERMSIG(status) == signal.SIGKILL
        child = None
        print('PASS broker death kills and reaps a busy worker')
    finally:
        if child is not None:
            os.kill(child, signal.SIGKILL)
            os.waitpid(child, 0)
        assert libc.prctl(36, was_subreaper.value, 0, 0, 0) == 0
    wrong_parent = subprocess.run(base + ['--parent-pid', str(os.getpid() + 1), '--', str(probe)],
                                  input=b'', stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
    assert wrong_parent.returncode == 91
    print('PASS mismatched broker parent fails closed')
    other_binary.chmod(0o4755)
    privileged_runtime = subprocess.run(base + ['--', str(other_binary), '--spin'],
                                        input=b'', stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, timeout=5)
    assert privileged_runtime.returncode == 91
    print('PASS set-ID runtime rejected before execution')
