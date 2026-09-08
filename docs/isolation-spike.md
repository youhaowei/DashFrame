# Per-workspace query isolation — feasibility spike

Status: **complete. A mechanism is proven on the deployment platform: Landlock.**

This records a bounded spike, not an implementation. It answers one question:
can a hosted, multi-user DashFrame run each workspace's DuckDB queries inside a
real OS sandbox, and does a legitimate chart query still work in there?

## Why the question is load-bearing

The Arrow data path executes SQL that originates in the browser. Mosaic composes
chart queries client-side and posts them to `/data/frames/:id/mosaic`, where the
only check applied to the statement is that it mentions the frame it names
(`packages/engine-server/src/arrow-data-path.ts`). `POST /data/arrow` accepts a
statement with no frame check at all. Everything else in either statement reaches
DuckDB as written.

DuckDB, unconfigured, grants that SQL the host process's filesystem and network:

```
$ SELECT current_setting('enable_external_access')   =>  true
$ SELECT * FROM read_text('/etc/hostname')           =>  ["/etc/hostname","...", ...]
```

For a single-user local-first app on the user's own machine, that is inside the
threat model. The moment two users share a runtime it is not: it is an arbitrary
read of every other workspace's data, of `/proc/self/environ`, and of the
encrypted vault blobs together with the key material that opens them.

Table-name prefixes do not address this. Neither does a distinct uid on its own,
and neither does a separate DuckDB connection or instance inside the same
process. The boundary has to be enforced by the OS.

## What was tested

Two artifacts, both in this branch:

- `scripts/sandbox-probe.ts` — reports the runtime's sandboxing primitives, then
  runs the workload below inside each candidate mechanism.
- `packages/engine-server/scripts/sandbox-duck-child.ts` — the workload. It
  registers two tables through the same typed-appender path the host uses for
  Arrow frames, runs a `JOIN` + `GROUP BY` + `sum()` (the shape a real chart over
  two frames compiles to), then probes the boundary.

Per candidate the probe records: whether it could be entered; whether the join
and aggregate produced rows; whether DuckDB's locked restrictions held against
user SQL trying to lift them; whether a file outside the sandbox was readable at
the OS level and separately through DuckDB; whether the network was reachable;
whether the parent's environment crossed the boundary; which descriptors were
inherited; and the uid inside.

The boundary targets are **disposable sentinels** the probe creates for the run:
a random marker string in a file under the OS temp directory, and a second random
marker planted in the child's environment. No existing data, credential, or volume
content is used as test material.

Run it with:

```sh
bun scripts/sandbox-probe.ts
```

## Result — local, 2026-09-06

| candidate                | entered | join/aggregate                    | restrictions held | sentinel via fs | sentinel via DuckDB | network     | host env leaked | uid  |
| ------------------------ | ------- | --------------------------------- | ----------------- | --------------- | ------------------- | ----------- | --------------- | ---- |
| none (baseline)          | yes     | `[["West",2,15],["East",1,7.25]]` | yes               | **readable**    | denied              | reachable   | **yes**         | 1000 |
| bubblewrap               | yes     | `[["West",2,15],["East",1,7.25]]` | yes               | denied          | denied              | unreachable | no              | 1000 |
| unshare (user+net+mount) | yes     | `[["West",2,15],["East",1,7.25]]` | yes               | **readable**    | denied              | unreachable | **yes**         | 0    |

Readings:

- **Bubblewrap is a usable mechanism.** It entered, the real workload produced
  correct rows, the sentinel was unreachable through the filesystem, and the
  sandbox had no network at all.
- **The baseline row is what makes the others mean something.** Without a
  sandbox the sentinel _is_ readable, so a "denied" elsewhere is the sandbox
  working rather than the file being absent.
- **The environment does not cross into bubblewrap.** The probe plants a marker
  variable standing in for the credentials the real host process carries in
  `environ`, and checks both `process.env` and `/proc/self/environ` inside the
  child. It is visible in the baseline and gone under `bwrap --clearenv`, which
  reinstates only `PATH` and `HOME`. This is not a nicety: the host holds the
  Convex admin credential and `DASHFRAME_SECRET_KEY` in its environment, so a
  child that inherits it has the keys no matter how good its mount namespace is.
  A mechanism is only reported usable if this check passes as well.
- **No host descriptors were inherited.** The descriptors open inside the child
  are the ones its own Bun runtime opens (`eventpoll`, `eventfd`,
  `/dev/urandom`, its own `statm`). This matters because an open descriptor
  crosses a mount-namespace boundary intact — it is a hole the filesystem view
  cannot close.
- **`unshare` alone is not a sandbox.** It gives namespaces but no filesystem
  restriction, and the sentinel stayed readable. It is reported because it
  isolates the kernel question (does this platform permit unprivileged user
  namespaces?) from the tooling question (is `bwrap` installed?).
- **The DuckDB settings are a genuine second layer, not decoration.** Even in the
  unsandboxed baseline, `read_text` on the sentinel was denied, and user SQL
  could not lift the restriction:

  ```
  SET enable_external_access=true
    => Invalid Input Error: Cannot change configuration option
       "enable_external_access" - the configuration has been locked
  ```

  Order matters: `lock_configuration=true` must be set last, because it locks
  itself and everything after it.

- The settings cost nothing functionally. Frame data reaches DuckDB through
  `registerArrowTable`, which decodes Arrow in-process and inserts through the
  typed Appender — the database engine reads no file. A file-backed
  `databasePath` also keeps working: it is attached before the settings apply,
  and reads, writes and `CHECKPOINT` against it were verified unaffected.

## Environment this was measured in

|                             |                                                               |
| --------------------------- | ------------------------------------------------------------- |
| branch / commit             | `codex/railway-single-server` @ `34b3c20`, based on `4bff1a8` |
| OS                          | Ubuntu 26.04.1 LTS, Linux 7.0.0-31-generic                    |
| Bun                         | 1.4.2                                                         |
| bubblewrap                  | 0.11.1                                                        |
| DuckDB binding              | `@duckdb/node-api` 1.5.3-r.3 (the pinned version)             |
| uid                         | 1000, no effective capabilities, `Seccomp: 0`                 |
| `unprivileged_userns_clone` | 1                                                             |

## Result — Railway, 2026-09-07

The same probe, run on a disposable probe-only service in the production Railway
project. Nothing was deployed to `dashframe-mcp`, the service had no volume, no
variables and no domain, and it was deleted after the evidence was captured.

Runtime it found there:

|                             |                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| kernel                      | Linux 6.18.15+deb13-cloud-amd64                                                           |
| uid / gid                   | 0 / 0                                                                                     |
| effective capabilities      | `CAP_DAC_OVERRIDE`, `CAP_SETGID`, `CAP_SETUID`, `CAP_SYS_CHROOT` — **no `CAP_SYS_ADMIN`** |
| seccomp                     | mode 2 (a filter is active)                                                               |
| `unprivileged_userns_clone` | 1                                                                                         |
| Landlock ABI                | 7                                                                                         |

| candidate       | entered | join/aggregate                    | restrictions held | sentinel via fs | sentinel via DuckDB | network     | host env leaked | uid |
| --------------- | ------- | --------------------------------- | ----------------- | --------------- | ------------------- | ----------- | --------------- | --- |
| none (baseline) | yes     | `[["West",2,15],["East",1,7.25]]` | yes               | **readable**    | denied              | reachable   | **yes**         | 0   |
| **landlock**    | **yes** | `[["West",2,15],["East",1,7.25]]` | yes               | denied          | denied              | unreachable | no              | 0   |
| bubblewrap      | **no**  | —                                 | —                 | —               | —                   | —           | —               | —   |
| unshare         | **no**  | —                                 | —                 | —               | —                   | —           | —               | —   |

### Mount-namespace sandboxes are unavailable on Railway

```
bwrap:   Creating new namespace failed: Permission denied
unshare: unshare failed: Permission denied
```

The userns sysctls are permissive and `max_user_namespaces` is large, so this is
not the kernel refusing namespaces on principle — a seccomp filter is active and
the container holds no `CAP_SYS_ADMIN`. Every mount-based sandbox is out,
bubblewrap included, and the local result for bubblewrap does not transfer.

### Landlock is the mechanism

Landlock needs no capability, no namespace and no mount operation: a process asks
the kernel to permanently narrow its own filesystem and (from ABI 4) TCP access.
`deploy/sandbox-probe/landlock-exec.c` does that and then execs the workload.
On Railway it entered, ran the real join and aggregate correctly, and could reach
neither the sentinel nor the network.

Getting there took three iterations, and the failures are worth recording because
each one is a trap for the implementation:

1. Granting only `/usr`, `/lib`, `/bin` and the workspace made the child **hang**
   until the probe killed it. A runtime denied `/proc/self` and `/etc` does not
   fail with a clear error.
2. With those added, DuckDB aborted inside the native library —
   `terminate called after throwing an instance of 'duckdb::InternalException'`,
   `"Attempted to dereference unique_ptr that is NULL!"`. Not catchable from
   JavaScript and it names nothing. The cause was `/sys`: DuckDB sizes its buffer
   pool from the container's cgroup limits.
3. `HOME` has to point somewhere writable — DuckDB creates an extension directory
   under it.

The path set that works is `/usr /lib /lib64 /bin /sbin /proc /etc /sys /run` plus
the application tree read-only, and the workspace, `/dev` and `/tmp` writable.

`/var` is deliberately **not** granted, because `/var/tmp` is where the probe puts
its out-of-sandbox sentinel. An earlier revision kept the sentinel in `/tmp`,
which the Landlock candidate has to grant — the boundary test would have passed
for the wrong reason.

### What Landlock does not do

It is a filesystem and TCP boundary, and nothing else. Stated plainly because the
implementation must not assume otherwise:

- **No environment isolation.** Clearing the environment stays the parent's job.
  The probe measures this: the marker planted in the probe's own environment is
  visible in the baseline and absent under Landlock only because the parent
  passes an explicit minimal environment. Bubblewrap's `--clearenv` is the same
  responsibility with more convenient packaging.
- **No UDP, no raw sockets.** Landlock ABI 4 covers TCP bind and connect only.
- **No process, IPC or PID isolation**, and no resource ceiling.
- It does not make uid 0 into a lesser user. The container runs as root; Landlock
  restricts that root process, which is the point, but it is not a substitute for
  dropping privileges where that is also possible. `CAP_SETUID`, `CAP_SETGID` and
  `CAP_SYS_CHROOT` are all present on Railway, so a uid drop can be layered on.

### Reproducing it

```sh
context=$(deploy/sandbox-probe/stage.sh)
(cd "$context" && railway link -p <project> -e <environment>)
railway add --service sandbox-probe-disposable
railway up "$context" --service sandbox-probe-disposable --ci
railway logs --service sandbox-probe-disposable
railway service delete --service sandbox-probe-disposable
```

`deploy/sandbox-probe/` is a disposable, probe-only artifact:

- `Dockerfile` — a minimal image containing the two probe scripts, the Landlock
  helper and the pinned `@duckdb/node-api`. No application source, no server, no
  Convex client, no vault code. It listens on no port and its `CMD` is the probe,
  which exits when finished.
- `railway.toml` — `restartPolicyType = "NEVER"`. Not `ON_FAILURE`: the probe
  exits non-zero when it finds no usable sandbox, and that is the single most
  important result it can produce. Retrying it would turn that finding into a
  restart loop.
- `stage.sh` — assembles the build context and prints the SHA-256 of every staged
  file, so a deployed artifact can be tied to an exact source revision.

The context is staged separately rather than deployed from the repository root
precisely so the root `railway.toml` cannot apply to it — the application's start
command would fail in this image, and its `ON_FAILURE` policy is the wrong one
here. Give the probe service **no volume, no variables and no domain**: an
inherited credential would sit in the environment of the very process whose
environment isolation is being measured.

## Risks and open items

- **Cross-workspace table visibility is a separate problem.** The locked settings
  close the file and network escape. They do nothing about one workspace naming
  another's registered table, because that is ordinary SQL against the same
  catalog. Only a per-workspace engine closes it, which is why the sandbox is the
  design and the settings are the backstop.
- **Process lifecycle and resource bounds are not designed yet.** A sandbox per
  workspace needs a spawn/idle/teardown policy and memory and CPU ceilings, or
  the isolation boundary becomes a denial-of-service surface instead.
- **The IPC surface has to be narrow.** The parent must hand the child Arrow IPC
  and SQL and receive Arrow IPC back, over a channel that carries nothing else —
  no environment, no inherited descriptors, no credential material.
- The probe's `unshare` candidate maps the caller to uid 0 inside the namespace.
  That is expected for `--map-root-user` and is not privilege on the host, but it
  is worth not misreading in the local table above.
- **The local and platform answers differ, and the platform one governs.**
  Bubblewrap works on a developer machine and does not work on Railway. Any
  implementation must therefore treat the sandbox as a configured mechanism with
  a startup self-check, not as something assumed present — and must refuse to
  serve multi-user traffic if the check fails, rather than continuing without it.
