# Linux query launcher

`query-launcher.c` enters the query worker boundary before the JavaScript runtime
starts. It requires Linux Landlock ABI 7 or newer, seccomp, `close_range`, a
nonroot final identity, and all requested resource limits. Every setup failure
exits 91; invalid trusted configuration exits 92. There is no unsandboxed mode.

The broker passes `--uid`, `--gid`, `--parent-pid`, `--memory-bytes`, `--cpu-seconds`, `--threads`,
one or more `--read` absolute paths, then `--` and the absolute runtime with its
arguments. Paths are a trusted deployment policy, never SQL or request input.
The allowlist must contain only immutable runtime artifacts and necessary system
files. Granting a directory grants its descendants: never grant a project,
workspace storage, home directory, shared temporary directory, or secrets root.
Missing paths fail rather than silently weakening an intended policy. Execution
is granted only to the exact runtime executable and the architecture's glibc ELF
interpreter, both of which must have no set-ID bits or file capabilities. Read
paths do not grant execution of other binaries. An interpreter can load other
readable code, but doing so does not apply that file's privileged metadata.

Only anonymous pipes or connected unnamed Unix stream socketpairs are accepted
on descriptors 0–2. Node's child-process pipes use the latter. Every other
descriptor is closed, the working directory becomes `/`, and the entire
environment is replaced with `LANG=C.UTF-8`, `TZ=UTC`, `HOME=/nonexistent`.
No file writes are granted. The launcher adds read access only to its own
`/proc/<pid>` directory; it never grants the general `/proc` tree.

A root launcher clears supplementary groups and drops all three user/group IDs.
It also removes capability bounding bits where `CAP_SETPCAP` permits; any bits
retained by a restricted container are reported. They cannot grant capabilities
through execution under `no_new_privs` and the cleared capability sets.
An already nonroot launcher must match the requested IDs and retains its existing
supplementary groups because an unprivileged process cannot remove them. In
both cases, effective/permitted/inheritable/ambient capabilities are cleared,
`no_new_privs` is set, and Landlock mediates file access independently of group
permissions. Hosted deployment should allocate distinct nonroot UIDs to active
workers; local tests can use the current UID with separate Landlock domains.

Landlock denies filesystem changes, TCP bind/connect, signals outside the worker
domain and abstract Unix-socket connections outside that domain. The additional
default-deny seccomp policy denies creation of all sockets (including UDP, raw
and Unix sockets), descriptor passing, process inspection, process creation and
other IPC. It allows thread creation only when `clone` includes `CLONE_THREAD`,
`CLONE_VM` and `CLONE_SIGHAND`; `clone3` returns ENOSYS to use that checked path.
Only `FIONBIO`/`FIONREAD` ioctls are allowed for runtime pipe handling. `execve`
remains available for runtime entry; subsequent execution retains every
restriction and can execute only those same runtime/interpreter inodes.
`prlimit64` permits only read-only queries for PID zero (the calling process);
both foreign-process access and changing limits are denied.

Resource limits are hard and checked after installation:

- `RLIMIT_AS`: total virtual address-space ceiling in bytes, not a dedicated RSS
  or container-memory quota. Node must use the broker's small-heap/JIT-disabled
  flags; Bun's large virtual reservations are not supported by the tested policy.
- `RLIMIT_CPU`: CPU seconds over the worker's entire lifetime, not per query.
- `RLIMIT_NPROC`: task ceiling aggregated by real UID. It is not a per-workspace
  quota if workers share a UID. Local current-UID limits also count unrelated
  processes and threads, and may prevent startup under heavy load.
- Descriptor count: 64. File size and core dump size: zero.

The broker must separately enforce wall-clock deadlines, cancellation, queue and
output bounds, process cleanup, and active-worker admission. These limits do not
establish Railway enforcement until this exact launcher is exercised there.
The launcher verifies the expected broker PID, installs `PDEATHSIG(SIGKILL)`
after dropping identity, and checks the parent again to close startup races.
Thus broker death kills even a worker busy inside native SQL. The broker must
remain the direct parent; wrapper processes cannot stand in for it.

The measured local Node 24/DuckDB worker starts without writable files using the
isolated worker bundle, the Node executable, `/usr/lib/x86_64-linux-gnu`,
`/dev/null`, and the worker's actual cgroup `memory.max` file as explicit read
paths. The cgroup path comes from the unified entry in `/proc/self/cgroup`; it
can be nested deeply below `/sys/fs/cgroup`. Granting only the root cgroup's
memory files does not work for a nested worker. Granting the entire cgroup tree
is unnecessary. The measured worker does not require general `/proc` files or
host `/etc` configuration. Pass Node `--openssl-config=/dev/null` to avoid
reading OpenSSL host config. This allowlist is deployment-specific and startup
must exercise a real query; an image with another library layout needs its own
explicit immutable library paths.

Run `python3 packages/engine-server/sandbox/test-native.py --cc <compiler>` to
compile and execute native boundary tests independently of DuckDB's restrictions.
The test uses disposable files and verifies denied foreign-file/parent-process
access, sanitized environment/descriptors, socket and process-IPC denial, zero
capabilities, working threads, hard memory/CPU ceilings, and fail-closed missing
policy paths. It does not deploy anything or establish Railway compatibility.
