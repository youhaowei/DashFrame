# Per-workspace query isolation — feasibility spike

Status: **local evidence complete; platform evidence NOT obtained.**

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

## What this does NOT establish

**This is a developer workstation, not the deployment platform.** Every number
above is local evidence. The Railway container differs in at least three ways
that decide the outcome, and none of them are knowable from here:

1. Whether the container runtime permits **unprivileged user namespaces**. If it
   does not, `bwrap` cannot enter and this mechanism is unavailable.
2. What **seccomp profile** is applied. The local run had none (`Seccomp: 0`); a
   container runtime typically applies one, and it may block `unshare`,
   `clone3` with namespace flags, or `pivot_root`.
3. Which **capabilities** the container retains. Locally there were none and
   bubblewrap did not need any; a different runtime configuration could change
   which fallback (`chroot` + uid drop) is even possible.

So the platform question is open, and it is answered by running the same probe
there — on a **disposable, probe-only service**, never on the service that runs
the API. Putting a probe mode into the application's start script was considered
and rejected: a stray variable on the serving service would take the API down.

`deploy/sandbox-probe/` holds that disposable artifact:

- `Dockerfile` — a minimal image containing the two probe scripts and the pinned
  `@duckdb/node-api` and nothing else. No application source, no server, no
  Convex client, no vault code. It listens on no port and its `CMD` is the probe,
  which exits when finished.
- `railway.toml` — `restartPolicyType = "NEVER"`. Not `ON_FAILURE`: the probe
  exits non-zero when it finds no usable sandbox, and that is the single most
  important result it can produce. Retrying it would turn that finding into a
  restart loop.
- `stage.sh` — assembles the build context and prints the SHA-256 of every
  staged file, so the deployed artifact can be tied to an exact source revision.

The context is staged separately rather than deployed from the repository root
precisely so the root `railway.toml` cannot apply to it — the application's start
command would fail in this image, and its `ON_FAILURE` policy is the wrong one
here.

Give the probe service **no volume, no variables and no domain**. The variables
matter most: an inherited credential would sit in the environment of the very
process whose environment isolation is being measured.

```sh
context=$(deploy/sandbox-probe/stage.sh)
(cd "$context" && railway up --service <disposable probe service>)
```

If the platform turns out not to permit it, that is a **deployment constraint to
report**, not a cue to fall back to in-process separation. Settings-only
confinement is defence in depth underneath an OS boundary; it is not a substitute
for one, because it lives inside the process it is meant to contain.

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
  is worth not misreading in the table above.
